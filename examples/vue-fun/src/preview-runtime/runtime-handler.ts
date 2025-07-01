// This file receives data from the editor.
// and provide `editorApi` to talk to editor.

import * as vue from "vue";
import { shallowRef } from "vue";
import { createWorkerDispatcher, createWorkerHandler, makePromise, type ImperativePromiseEx } from "yon-utils";

export type RuntimeActions = typeof actionHandlers
const actionHandlers = {
  async updateChunk(built: BuiltChunk) {
    builtChunkManager.updateChunk(built)
  }
}

export interface BuiltChunk {
  name: 'user' | 'vendor'
  externals: string[]
  js: string
  css: string
}

export const editorApi = shallowRef<EditorActions>();
export type EditorActions = {
  notifyReady(): Promise<void>
}

//#region BuiltChunkManager -------------------------------------------

const $updatingPromise = Symbol('updatingPromise')
declare global {
  interface HTMLScriptElement {
    [$updatingPromise]: ImperativePromiseEx<any>
  }
}

class BuiltChunkMounter {
  name: string
  previousChunk: BuiltChunk | null = null
  style: HTMLElement | Comment
  script: HTMLElement | Comment

  revision = vue.ref(0)

  /** 
   * once the chunk is loaded, this will be resolved with the exports
   * 
   * if `__updateBuiltChunk()` starts updating chunk, it will become a new pending Promise, 
   * then resolve with newest exports
   */
  loadPromise = makePromise<any>()
  lastExports = {}

  constructor(name: string) {
    this.name = name

    const style = document.createComment(`built chunk css ${name}`)
    document.head.appendChild(style)
    this.style = style

    const script = document.createComment(`built chunk js ${name}`)
    document.body.appendChild(script)
    this.script = script
  }

  update(chunk: BuiltChunk) {
    const name = chunk.name
    const prev = this.previousChunk
    const updatingPromise = !prev ? this.loadPromise : (this.loadPromise = makePromise());

    let changed = false
    updatingPromise.then((exports) => {
      this.lastExports = exports
      if (changed) this.revision.value++
    })

    if (chunk.css !== prev?.css) {
      const style = document.createElement('style')
      style.textContent = chunk.css
      this.style.replaceWith(style)
      this.style = style

      changed = true
    }

    if (chunk.js !== prev?.js) {
      const prelude = `self.__updateBuiltChunk(${JSON.stringify(name)}, (require, module, exports) => { `

      const oldScript = this.script
      const newScript = document.createElement('script')
      newScript.setAttribute('data-built-chunk-name', name)
      newScript.src = URL.createObjectURL(new Blob([prelude, chunk.js, '\n})'], { type: 'text/javascript' }));
      newScript[$updatingPromise] = updatingPromise

      oldScript.after(newScript)
      this.script = newScript
      changed = true
    } else {
      updatingPromise.resolve(this.lastExports)
    }

    this.previousChunk = chunk
  }
}

function createBuiltChunkManager() {
  const chunkMounters: Record<string, BuiltChunkMounter> = {
    vendor: new BuiltChunkMounter('vendor'),  // go first! affect insert position
    user: new BuiltChunkMounter('user'),
  };

  const builtinModules: Record<string, any> = {
    vue,
    "@runtime/require": fakeRequire,
  };

  (window as any).__updateBuiltChunk = (name: string, factory: (require: any, module: any, exports: any) => any) => {

    const el = document.currentScript as HTMLScriptElement;
    const updatingPromise = el?.[$updatingPromise];
    if (!updatingPromise) throw new Error('no current script');

    const pendingPromises: Promise<any>[] = [];
    if (name !== 'vendor') pendingPromises.push(chunkMounters.vendor.loadPromise); // vendor chunk must be loaded first

    const module = { exports: {} }
    Promise.all(pendingPromises)
      .then(() => (factory(fakeRequire, module, module.exports), module.exports))
      .then(exports => {
        console.log('updating chunk', name, exports)
        updatingPromise.resolve(exports)
      })
  }

  function fakeRequire(id: string) {
    if (id in builtinModules) return builtinModules[id]

    const vendorExports = chunkMounters.vendor.loadPromise.value
    const deps = vendorExports.deps;
    if (id in deps) return deps[id]();

    throw new Error(`Unknown require id: ${id}`)
  }

  return {
    updateChunk(chunk: BuiltChunk) {
      let chunkMounter = this.getChunk(chunk.name)
      chunkMounter.update(chunk)
    },
    async getChunkExports(name: string) {
      const mounter = chunkMounters[name]
      if (!mounter) throw new Error(`Unknown chunk name: ${name}`)
      return await mounter.loadPromise
    },
    getChunk(name: string) {
      return chunkMounters[name]
    },
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
