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
    vuePlugin.options.patchCompiledScript = ({ filePath, compiledScript, hmrId }) => {
      const out = vuePatchScriptForInspector(compiledScript.content, compiledScript.map?.mappings)
      if (out && hmrId) {
        const [code, mappings] = out
        compiledScript.content = code
        if (compiledScript.map) compiledScript.map.mappings = mappings
      }

      // for hmr
      const importedSymbols = Object.keys(compiledScript.imports || {})
      if (this.isBuildingHMRPatch) {
        // check whether no new import added (maybe someday bundler-in-browser will support better)
        for (const id of importedSymbols) {
          if (!this.vueFiles[filePath].importedSymbols.has(id)) {
            throw new Error(`[vue-inspector] HMR patch failed: new import added: ${id}`)
          }
        }

        // no new import, we replace the import statements
        //
        // FIXME: maybe string replacing is not safe
        // FIXME: dynamic import???
        compiledScript.content =
          `import { ${importedSymbols.join(', ')} } from '${virtualPathInheritImportsPrefix}${hmrId}';`
          + compiledScript.content.replace(
            // comment out import statements with /* ... */
            // dark regex supports:
            //   import*as foo from "xxx"
            //   import XXX,{yyy}from 
            //   import XXX from "xxx"
            //   import{yyy}from "xxx"
            /\bimport(\s*\*\s*as\s+\S+\s+|\s+[^{\s,]+([,\s]+{[^}]*}|\s+)|\s*{[^}]+}\s*)from\s*('[^']+'|"[^"]+")/gm,
            (matched) => {
              if (importedSymbols.some(id => matched.includes(id))) {
                return '/* ' + matched + ' */'
              }
              return matched   // not imported thing?
            }
          )
      }
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
    importedSymbols: Set<string>,
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

  get isBuildingHMRPatch() {
    return Object.keys(this.vueFiles).length > 0
  }
  mockEntryPlugin: Plugin = {
    name: 'vue-shabby-hmr',
    setup: (build) => {
      if (!this.isBuildingHMRPatch) return;

      const vueFiles = this.vueFiles
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

      // resolve imports of "vue-shabby-hmr:inherit:HMR_ID" and "vue-shabby-hmr:runtime" 
      // as external
      build.onResolve({ filter: /./, namespace: 'sfc-script' }, (args) => {
        if (args.path === virtualPathRuntime || args.path.startsWith(virtualPathInheritImportsPrefix)) {
          return {
            external: true,
            path: args.path,
          }
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

      const oldImportedSymbols = new Set<string>(Object.keys(old.compiledScript?.imports ?? {}))
      // we currently not parsed the <script> blocks, and this check goes to patchCompiledScript
      // (because parsing options is too complex)

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
        importedSymbols: new Set(oldImportedSymbols),
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
