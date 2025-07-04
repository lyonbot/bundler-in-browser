// This file receives data from the editor.
// and provide `editorApi` to talk to editor.

import * as shabbyVueHMRConsts from "@/abilities/shabby-vue-hmr/consts";
import { ShabbyVueHMRRuntime } from "@/abilities/shabby-vue-hmr/runtime-side";
import * as vue from "vue";
import { shallowRef } from "vue";
import { createWorkerDispatcher, createWorkerHandler, makePromise } from "yon-utils";

export type RuntimeActions = typeof actionHandlers
const actionHandlers = {
  async updateChunk(name: 'user' | 'vendor', built: { js: string; css: string }) {
    const mount = builtChunkManager.getChunk(name)
    mount.updateJS(built.js)
    mount.updateCSS(built.css)
  },
  async applyHMR(opts: { css: string, js: string }) {
    // hmr is different. it execute incremental js,
    // and replace the whole css
    builtChunkManager.getChunk('hmr').updateJS(opts.js)
    builtChunkManager.getChunk('user').updateCSS(opts.css)
  },
}


export const editorApi = shallowRef<EditorActions>();
export type EditorActions = {
  notifyReady(): Promise<void>
}

//#region BuiltChunkManager and Vue HMR -------------------------------------------

class BuiltChunkMountPoint {
  name: string
  style: HTMLElement | Comment
  script: HTMLElement | Comment

  /**
   * current chunk state
   * 
   * is a reactive object, so you can watch it.
   */
  current = vue.shallowReactive({
    css: '',
    js: '',
    exports: null as any,   // js execution result
    exportsPromise: makePromise<any>(),
  })

  constructor(name: string) {
    this.name = name

    const style = document.createComment(`built chunk css ${name}`)
    document.head.appendChild(style)
    this.style = style

    const script = document.createComment(`built chunk js ${name}`)
    document.body.appendChild(script)
    this.script = script
  }

  #isFirstJsExecute = true
  updateJS(js: string) {
    const { current, name } = this
    if (js === current.js) return null; // no change

    const promise = this.#isFirstJsExecute ? current.exportsPromise : (current.exportsPromise = makePromise<any>());
    this.#isFirstJsExecute = false;

    const prelude = `self.__runBuiltChunk(${JSON.stringify(name)}, (require, module, exports) => { `

    const oldScript = this.script
    const newScript = document.createElement('script')
    newScript.addEventListener('executed', (evt: any) => {
      const exports = evt.detail
      promise.resolve(exports)
      if (promise === current.exportsPromise) current.exports = exports
    })
    newScript.setAttribute('data-built-chunk-name', this.name)
    newScript.src = URL.createObjectURL(new Blob([prelude, js, '\n})'], { type: 'text/javascript' }));

    oldScript.after(newScript)
    this.script = newScript

    current.js = js
    return promise
  }

  updateCSS(css: string) {
    const current = this.current
    if (css === current.css) return false; // no change

    const style = document.createElement('style')
    style.textContent = css
    style.setAttribute('data-built-chunk-name', this.name)
    this.style.replaceWith(style)
    this.style = style

    current.css = css
    return true;
  }
}

const shabbyVueHMRRuntime = new ShabbyVueHMRRuntime()

function createBuiltChunkManager() {
  const chunkMounters = {
    vendor: new BuiltChunkMountPoint('vendor'),  // go first! affect insert position
    user: new BuiltChunkMountPoint('user'),
    hmr: new BuiltChunkMountPoint('hmr'),
  } satisfies Record<string, BuiltChunkMountPoint>

  const builtinModules: Record<string, any> = {
    vue,
    "@runtime/require": fakeRequire,
  };

  // a global function for loaded script
  (window as any).__runBuiltChunk = (name: string, factory: (require: any, module: any, exports: any) => any) => {
    // find the promise to resolve, when chunk code executed
    // it's on current script element, with special attribute
    const scriptEl = document.currentScript as HTMLScriptElement;
    const resolve = (exports: any) => scriptEl.dispatchEvent(new CustomEvent('executed', { detail: exports }));

    // before run, wait for its dependencies
    const pendingPromises: Promise<any>[] = [];
    if (name === 'user') pendingPromises.push(
      chunkMounters.vendor.current.exportsPromise,   // user chunk shall run after vendor
    );

    // now run the chunk code
    const module = { exports: {} }
    Promise.all(pendingPromises)
      .then(() => (factory(fakeRequire, module, module.exports), module.exports))
      .then(exports => {
        // now chunk code executed, resolve its promise with the exports
        console.log(`[chunk:${name}] executed`, exports)
        resolve(exports)
      })
  }

  function fakeRequire(id: string) {
    // preinstalled like `vue`
    if (id in builtinModules) return builtinModules[id]

    // vue-shabby-hmr:runtime
    // see ../shabby-vue-hmr/README.md
    if (id === shabbyVueHMRConsts.virtualPathRuntime) return shabbyVueHMRRuntime;
    if (id.startsWith(shabbyVueHMRConsts.virtualPathInheritImportsPrefix)) {
      const hmrId = id.slice(shabbyVueHMRConsts.virtualPathInheritImportsPrefix.length)
      const deps = shabbyVueHMRRuntime.getDeps(hmrId)
      return deps
    }

    // vendor bundle's export
    if (chunkMounters.vendor.current.exportsPromise.status !== 'fulfilled') {
      throw new Error('vendor chunk status: ' + chunkMounters.vendor.current.exportsPromise.status)
    }
    const vendorExports = chunkMounters.vendor.current.exports;
    const deps = vendorExports.deps;
    if (id in deps) return deps[id]();

    // unknown
    throw new Error(`Unknown require id: ${id}`)
  }

  return {
    getChunk: (name: keyof typeof chunkMounters) => {
      const mounter = chunkMounters[name]
      if (!mounter) throw new Error(`Unknown chunk name: ${name}`)
      return mounter
    }
  }
}

export const builtChunkManager = createBuiltChunkManager()

//#endregion

//#region connection ----------------------------------------------

/** 
 * the editor may send a message like this, to establish connection
 * 
 * `port` is a bidirectional MessagePort, editor may send RuntimeActions via it, and editor will receive EditorActions from that.
 */
export type ConnectionEstablisher = {
  type: '__connect_vue_fun__'
  port: MessagePort
}

// handle connection from editor
// once ready, will setup `editorApi` and call `onConnectedToEditor`
self.addEventListener('message', function (e: MessageEvent) {
  const data = e.data as ConnectionEstablisher | undefined;
  if (data?.type !== '__connect_vue_fun__') return;

  const port = data.port;
  const handleActions = createWorkerHandler(actionHandlers);
  port.onmessage = e => handleActions(e.data);
  port.start();

  const currentEditorApi = createWorkerDispatcher<EditorActions>((payload, transferable) => {
    port.postMessage(payload, transferable);
  })

  editorApi.value = currentEditorApi;
  currentEditorApi.notifyReady().then(() => {
    console.log('editor connected')
  })
})

//#endregion
