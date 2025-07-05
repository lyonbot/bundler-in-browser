import { vueInspectorNodeTransform, vuePatchScriptForInspector } from "@/abilities/vue-inspector/for-bundler";
import type { VuePluginInstance, VueSfcCacheItem } from "bundler-in-browser";
import { forEach, noop } from "yon-utils";
import * as compiler from 'vue/compiler-sfc';
import type { Plugin } from "esbuild-wasm";
import { virtualPathRuntime, virtualPathInheritImportsPrefix } from "./constants";

class State {
  constructor(
    public vuePlugin: VuePluginInstance,
  ) {
    vuePlugin.options.hmr = true
    vuePlugin.options.templateCompilerOptions = {
      nodeTransforms: [
        vueInspectorNodeTransform, // add `data-v-inspector` attribute to all Vue elements
      ],
    }
    vuePlugin.options.patchCompiledScript = ({ compiledScript, hmrId }) => {
      const out = vuePatchScriptForInspector(compiledScript.content, compiledScript.map?.mappings)
      if (out && hmrId) {
        const [code, mappings] = out
        compiledScript.content = code
        if (compiledScript.map) compiledScript.map.mappings = mappings
      }

      // for hmr
      const importedSymbols = Object.keys(compiledScript.imports || {})
      compiledScript.content += `
        import __vueShabbyHMRExtra from ${str(virtualPathRuntime)};
          __vueShabbyHMRExtra.rememberDep(${str(hmrId)}, { ${importedSymbols.join(', ')} });`
    }
    vuePlugin.options.patchTemplateCompileResults = ({ templateCompileResults }) => {
      const out = vuePatchScriptForInspector(templateCompileResults.code, templateCompileResults.map?.mappings)
      if (out) {
        templateCompileResults.code = out[0]
        if (templateCompileResults.map) templateCompileResults.map.mappings = out[1]
      }
    }

    const { bundler } = vuePlugin
    bundler.userCodePlugins.unshift(this.mockEntryPlugin)
  }

  vueFiles: Record<string, {
    old: VueSfcCacheItem,
    hmrId: string,
    oldDescriptor: import('vue/compiler-sfc').SFCDescriptor,
    newDescriptor: import('vue/compiler-sfc').SFCDescriptor,
    op: 'reload' | 'rerender',
    // style not cared -- we always rebuild whole project later
  }> = {}

  get bundler() { return this.vuePlugin.bundler }

  dispose() {
    const vuePlugin = this.vuePlugin
    vuePlugin.options.hmr = false
    vuePlugin.options.templateCompilerOptions = null
    vuePlugin.options.patchCompiledScript = noop
    vuePlugin.options.patchTemplateCompileResults = noop
    stateStore.delete(vuePlugin)

    const { bundler } = vuePlugin
    const index = bundler.userCodePlugins.indexOf(this.mockEntryPlugin)
    if (index !== -1) bundler.userCodePlugins.splice(index, 1)
  }

  mockEntryPlugin: Plugin = {
    name: 'vue-shabby-hmr',
    setup: (build) => {
      const vueFiles = this.vueFiles
      if (Object.keys(vueFiles).length === 0) return;

      const namespace = 'vue-shabby-hmr';

      // file provider: entry and hmr-patch
      build.onResolve({ filter: /./ }, (args) => {
        let path: string;
        if (args.kind === 'entry-point') path = 'entry'
        else if (args.path === `${namespace}:hmr-patch` && args.namespace === namespace) path = 'hmr-patch'
        else return null;

        return {
          path,
          namespace: 'vue-shabby-hmr',
          pluginData: {
            resolveDir: args.resolveDir,
          }
        }
      })

      build.onLoad({ filter: /^entry$/, namespace }, (args) => {
        const { resolveDir } = args.pluginData
        const contents = [
          `import "${namespace}:hmr-patch";`,
          `import __vueShabbyHMRExtra from ${str(virtualPathRuntime)};`,
          '__vueShabbyHMRExtra.reset();',  // inherited deps are consumed. safe to reset.
        ]

        return {
          contents: contents.join('\n'),
          loader: 'js',
          resolveDir
        }
      })

      build.onLoad({ filter: /^hmr-patch$/, namespace }, (args) => {
        const { resolveDir } = args.pluginData
        const contents: string[] = []

        let index = 0
        forEach(vueFiles, (item, path) => {
          const ident = `Component${index++}`
          const { op, hmrId } = item

          contents.push(
            `import ${ident} from ${str(path)};`,
            'if (typeof __VUE_HMR_RUNTIME__ !== "undefined") {',
            op === 'reload'
              ? `__VUE_HMR_RUNTIME__.reload(${str(hmrId)}, ${ident});`
              : `__VUE_HMR_RUNTIME__.rerender(${str(hmrId)}, ${ident}.render);`,
            '}',
          )
        })

        return {
          contents: contents.join('\n'),
          loader: 'js',
          resolveDir
        }
      })

      // replace imports to "vue-shabby-hmr:inherit:HMR_ID"
      // to reuse (inherit) imported modules from existing instance
      build.onResolve({ filter: /./ }, (args) => {
        if (!/\.vue\?type=script/.test(args.importer)) return null;  // only handle imports from <script>
        if (args.path === virtualPathRuntime) return null;  // no need for hmr runtime

        const importer = args.importer?.replace(/\?.*/, '')
        const sfc = vueFiles[importer]
        if (!sfc) return null;

        return {
          external: true,
          path: virtualPathInheritImportsPrefix + sfc.hmrId,
        }
      })
    }
  }

  /**
   * check whether next build can serve as HMR patch.
   * 
   * if no, return nothing, and next build is normal build.
   * 
   * if yes, activate a special ESBuild plugin (replacing entry point, and deps of vue), and do a build.
   */
  async tryBuildHMRPatch(changedFilePaths: string[]) {
    const { bundler, vuePlugin } = this
    const { fs } = bundler

    this.vueFiles = {}
    const vueFiles: State['vueFiles'] = {}  // assign to this.vueFiles later -- maybe can't HMR

    for (const path of changedFilePaths) {
      if (path.slice(-4).toLowerCase() !== '.vue') return

      const old = vuePlugin.sfcCache.get(path)
      if (!old) continue  // not even existed, just ignore (maybe still can HMR?)

      const hmrId = old.hmrId
      if (!hmrId) continue  // ?

      const newContent = await new Promise<string | null>((res) => fs.readFile(path, 'utf8', (err, data) => { if (err) res(null); else res(data); }))
      if (!newContent) return  // deleted, can't HMR

      const newResult = compiler.parse(newContent, { sourceMap: false })
      if (newResult.errors.length) continue  // syntax error, can't HMR

      const oldDescriptor = old.descriptor
      const newDescriptor = newResult.descriptor

      const templateChanged = oldDescriptor.template?.content !== newDescriptor.template?.content
      const scriptChanged = oldDescriptor.script?.content !== newDescriptor.script?.content
      const scriptSetupChanged = oldDescriptor.scriptSetup?.content !== newDescriptor.scriptSetup?.content

      const oldImportedSymbols = new Set<string>() // "importee:symbol", where "symbol" can be "*" or identifier
      for (const item of Object.values(oldDescriptor.scriptSetup?.imports ?? {})) {
        oldImportedSymbols.add(`${item.source}:${item.imported}`)
      }

      let op: 'reload' | 'rerender' | undefined
      if (scriptChanged || scriptSetupChanged) op = 'reload'
      else if (templateChanged) op = 'rerender'
      else continue // no change, or just style change.

      vueFiles[path] = {
        old,
        hmrId,
        oldDescriptor,
        newDescriptor,
        op,
      }
    }

    // ----------------------------------------------
    // check pass! can do HMR!
    // generate a mock entry.

    try {
      this.vueFiles = vueFiles  // this will activate "mockEntryPlugin"
      const builder = await bundler.createUserCodeBuildHelper()
      const output = await builder.build()
      return {
        js: output.js,
      }
    } catch (e) {
      console.error('vue-hmr tryBuildHMRPatch error', e)
      // ignore error, just return
    } finally {
      this.vueFiles = {}  // disable "mockEntryPlugin"
    }
  }
}

const stateStore = new WeakMap<VuePluginInstance, State>()

export function setEnableVueHMR(vuePlugin: VuePluginInstance, isEnabled: boolean) {
  if (!isEnabled) {
    stateStore.get(vuePlugin)?.dispose()
  } else {
    if (!stateStore.has(vuePlugin)) {
      const state = new State(vuePlugin)
      stateStore.set(vuePlugin, state)
    }
  }
}

export function tryBuildHMRPatch(vuePlugin: VuePluginInstance, changedFiles: string[]) {
  return stateStore.get(vuePlugin)?.tryBuildHMRPatch(changedFiles)
}

const str = (val: any) => JSON.stringify(val)
