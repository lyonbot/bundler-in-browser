import { stringHash } from 'yon-utils';
import * as compiler from 'vue/compiler-sfc';
import { type Position } from '@vue/compiler-core';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";
import path from "path";
import { memoAsync, stripQuery } from '../utils/index.js';
import { countChar, getLineText, offsetToPosition, toBase64 } from '../utils/string.js';

export interface InstallVuePluginOptions {
  disableOptionsApi?: boolean;
  enableProdDevTools?: boolean;
  enableHydrationMismatchDetails?: boolean;
  isProd?: boolean;

  /** only works with `<script setup>`. might made HMR fails. */
  inlineTemplate?: boolean;

  /**
   * options for template compiler, including ParserOptions & TransformOptions & CodegenOptions
   * 
   * for example, use `nodeTransforms` to add custom attrs
   * 
   * you can pass a partial object, or a `function (initialOptions, sfcDescriptor): newOptions`
   */
  templateCompilerOptions?: OptionsPatcher<compiler.CompilerOptions, [descriptor: compiler.SFCDescriptor]>;

  /**
   * options for `compileScript()`
   * 
   * for example, use `nodeTransforms` to add custom attrs
   * 
   * you can pass a partial object, or a `function (initialOptions, sfcDescriptor): newOptions`
   */
  scriptCompilerOptions?: OptionsPatcher<compiler.SFCScriptCompileOptions, [descriptor: compiler.SFCDescriptor]>;

  /**
   * inject extra code to sfc runtime, after script & render, before final `export default ___vue_component__`
   * 
   * @see patchCompiledScript
   */
  injectSFCRuntime?: (ctx: {
    filePath: string,
    /** parsed SFC descriptor */
    descriptor: compiler.SFCDescriptor,
    /** the exported identifier of SFC. usually is `__vue_component__` */
    COMP_IDENTIFIER: string,
    /** only valid when scoped style exists */
    scopeId?: string,
    /** only valid when hmr is enabled. usually equals to `__vue_component__.__hmrId` */
    hmrId?: string
  }) => MaybePromise<string | null | void>;

  /**
   * inject extra code after the compiled script, before render function
   * 
   * or patch the `compiledScript.content` directly.
   * 
   * @see injectSFCRuntime
   * @see patchTemplateCompileResults
   */
  patchCompiledScript?: (ctx: VueSfcCacheItem & {
    /**
     * compiled script block. contains useful info like `bindings`, `imports`, ast etc.
     * 
     * in `patchCompiledScript`, you can modify `compiledScript.content` and `compiledScript.map` to modify the final script code.
     */
    compiledScript: compiler.SFCScriptBlock
  }) => MaybePromise<void>;

  /**
   * patch the compiled template script.
   * 
   * @remarks 
   * - not work if `inlineTemplate` is `true` and `<script setup>` exists.
   * - you can modify `templateCompileResults.code` and `templateCompileResults.map` to modify the final template code.
   * 
   * @see injectSFCRuntime
   * @see patchCompiledScript
   */
  patchTemplateCompileResults?: (ctx: VueSfcCacheItem & {
    /** 
     * the compiled template results 
     * 
     * may be modified by `patchTemplateCompileResults`
     */
    templateCompileResults: compiler.SFCTemplateCompileResults
  }) => MaybePromise<void>;

  /** whether inject HMR related code `__VUE_HMR_RUNTIME__.createRecord(hmrId, sfcMain)` */
  hmr?: boolean;

  /** 
   * custom HMR id generator. works with `hmr: true`.
   * 
   * defaults to `filePath => filePath` */
  hmrId?: (filePath: string) => string | Promise<string>;
}

const COMP_IDENTIFIER = '__vue_component__';

export interface VuePluginInstance {
  bundler: BundlerInBrowser;
  options: Required<InstallVuePluginOptions>;
  plugin: esbuild.Plugin;
  /** 
   * contains all .vue sfc file information.
   * 
   * cleared when build start, and updated for each .vue file.
   * 
   * you can access this after built
   */
  sfcCache: Map<string, VueSfcCacheItem>;
}

export interface VueSfcCacheItem {
  filePath: string,
  /** the exported identifier of SFC. usually is `__vue_component__` */
  COMP_IDENTIFIER: string,
  /** parsed SFC descriptor */
  descriptor: compiler.SFCDescriptor,
  sfcPraseErrors: compiler.SFCParseResult['errors'],
  /** 
   * compiled script block. contains useful info like `bindings`, `imports`, ast etc.
   * 
   * - Don't modify, won't work.
   * - Might be undefined, if no `<script>` in SFC.
   */
  compiledScript?: compiler.SFCScriptBlock,
  /** only valid when hmr is enabled. usually equals to `__vue_component__.__hmrId` */
  hmrId?: string,
  /** only valid when scoped style exists */
  scopeId?: string,
}

const defaultOptions: Required<InstallVuePluginOptions> = {
  disableOptionsApi: false,
  enableProdDevTools: false,
  enableHydrationMismatchDetails: false,
  isProd: false,
  inlineTemplate: false,
  templateCompilerOptions: null,
  scriptCompilerOptions: null,
  hmr: false,
  hmrId: (filePath) => filePath,
  injectSFCRuntime: () => '',
  patchCompiledScript: () => void 0,
  patchTemplateCompileResults: () => void 0,
}

export default function installVuePlugin(bundler: BundlerInBrowser, opts: InstallVuePluginOptions = {}) {
  const instance: VuePluginInstance = {
    bundler,
    options: {
      ...defaultOptions,
      ...opts,
    },
    plugin: null as unknown as esbuild.Plugin, // assign later
    sfcCache: new Map(),
  };

  const plugin: esbuild.Plugin = {
    name: "vue-loader",
    setup(build) {
      const opts = instance.options;
      const isProd = opts.isProd;
      build.initialOptions.define = {
        "__VUE_OPTIONS_API__": opts.disableOptionsApi ? "false" : "true",
        "__VUE_PROD_DEVTOOLS__": opts.enableProdDevTools ? "true" : "false",
        "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": opts.enableHydrationMismatchDetails ? "true" : "false",
        ...build.initialOptions.define,
      }

      build.onStart(() => {
        instance.sfcCache.clear();
      })

      // Resolve main ".vue" import
      build.onResolve({ filter: /\.vue/ }, async (args) => {
        const params = getUrlParams(args.path);

        let namespace = 'file';
        if (params.type === "script") namespace = "sfc-script";
        else if (params.type === "template") namespace = "sfc-template";
        else if (params.type === "style") namespace = "sfc-style";

        return {
          path: getFullPath(args),
          namespace,
          pluginData: {
            ...args.pluginData,
            index: params.index, // not in `vue: ...`
          }
        }
      });

      build.onLoad({ filter: /./, namespace: "sfc-style" }, async (args) => {
        const vuePluginData = args.pluginData.vue as VuePluginMiddleData;
        const { descriptor, id, toESBuildError } = vuePluginData;
        const style = descriptor.styles[args.pluginData.index];

        const preprocessCustomRequire = /s[ac]ss/.test(style.lang!) ? await getPreprocessCustomRequireWithSass() : undefined

        // TODO: "style.module" not supported yet

        const { code, map, errors: errorsAll } = await compiler.compileStyleAsync({
          filename: descriptor.filename,
          id: id,
          isProd,
          scoped: style.scoped,
          modules: !!style.module,
          source: style.content,
          preprocessLang: style.lang as any,
          preprocessCustomRequire,
        });

        const errors = errorsAll.filter((e, i) => !(i === 0 && e.message.includes('pathToFileURL')));
        if (errors.length > 0) return {
          errors: errors.map((e: any): esbuild.PartialMessage => ({
            text: 'style: ' + (e.reason || e.message || e),
            location: {
              file: toESBuildError.ctx.currentFile,
              ...e.line >= 1 ? {   // for css
                line: e.line - 1 + style.loc.start.line,
                column: e.column - 1,
                lineText: getLineText(e.source, e.line),
              } : null,
              ...e.sassStack && e.span ? {   // for sass
                ...toESBuildError.ctx.offsetToPosition?.(e.span.start.offset + style.loc.start.offset),
              } : null,
            }
          }))
        };

        let finalCode = code;
        if (map) {
          const mapStr = JSON.stringify(map);
          finalCode += '\n\n' + `/*# sourceMappingURL=data:application/json;base64,${toBase64(mapStr)} */`;
        }

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: finalCode,
          loader: 'css',
          pluginData: { ...args.pluginData }
        })
      })

      build.onLoad({ filter: /./, namespace: "sfc-template" }, async (args) => {
        // Note: shall after `sfc-script` loader
        // because it might need to know `bindingMetadata` from `scriptSetup`
        const vuePluginData = args.pluginData.vue as VuePluginMiddleData;
        const { compiledScriptPromise, templateCompileOptions, sfcCacheItem, toESBuildError } = vuePluginData;

        if (!templateCompileOptions) {
          return {
            loader: 'js',
            contents: 'export function render() {}',
            errors: [{ text: 'template compiler options not found' }]
          }
        }

        // `bindingMetadata` from `scriptSetup` is now available
        templateCompileOptions.compilerOptions!.bindingMetadata = (await compiledScriptPromise)?.bindings;

        const ans = compiler.compileTemplate(templateCompileOptions);
        if (ans.errors.length > 0) return { errors: ans.errors.map(e => toESBuildError(e)) };

        // rawCode contains `export (function|const) (render|ssrRender)`
        await instance.options.patchTemplateCompileResults?.({
          ...sfcCacheItem,
          templateCompileResults: ans,
          // note: `sfcCacheItem.compiledScript` is already updated by `await compiledScriptPromise` above
        })

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: ans.code,
          loader: 'js',
          pluginData: {
            ...args.pluginData,
          }
        });
      })

      build.onLoad({ filter: /./, namespace: "sfc-script" }, async (args) => {
        const vuePluginData = args.pluginData.vue as VuePluginMiddleData;
        const { descriptor, templateCompileOptions, id, hasTS, hasJSX, sfcCacheItem, toESBuildError, provideCompiledScript } = vuePluginData;

        const filename = descriptor.filename;
        let compiledScript: ReturnType<typeof compiler.compileScript>;
        try {
          const options = await invokeOptionsPatcher(
            instance.options.scriptCompilerOptions,
            {
              inlineTemplate: instance.options.inlineTemplate,
              id,
              isProd,
              genDefaultAs: COMP_IDENTIFIER,
              fs: {
                fileExists: (file) => bundler.fs.existsSync(file),
                readFile: (file) => { try { return bundler.fs.readFileSync(file, 'utf8') as string; } catch { } },
                realpath: (file) => bundler.fs.realpathSync(file, { encoding: 'utf8' }) as string,
              },
              templateOptions: templateCompileOptions || undefined,
            },
            descriptor
          );
          compiledScript = compiler.compileScript(descriptor, options);
        } catch (e) {
          if ('loc' in (e as any)) {
            // vue-compiler doesn't fix Babel's loc information.try to find out the real loc
            // (could be in script or scriptSetup)
            const offsetPos0 = descriptor.script?.loc.start
            const offsetPos1 = descriptor.scriptSetup?.loc.start

            let offsetPos = offsetPos0 || offsetPos1
            if (offsetPos0 && offsetPos1) {
              // both exists! try to find out by parsing Vue generated codeFrame
              let m = String(e)
              let lp = /^\s+\|\s*\^/m.exec(m)?.index // the line of  "   |   ^"
              let lp2 = m.lastIndexOf('|', lp! + 1) // prev line like  "21 | v.."
              let lp3 = m.lastIndexOf('\n', lp2) + 1 // prev line like  "21 | v.."
              let lineNo = parseInt(m.slice(lp3, lp2), 10)

              if (offsetPos0.line <= lineNo && descriptor.script!.loc.end.line >= lineNo) {
                offsetPos = offsetPos0
              } else {
                offsetPos = offsetPos1
              }
            }

            // fix loc information for Babel
            const loc = (e as any).loc as BabelSyntaxError['loc']
            loc.line += offsetPos!.line
            loc.column += offsetPos!.column
            loc.index += offsetPos!.offset
          }
          provideCompiledScript(new Error(`failed to compile <script>: ${e}`), undefined)
          return { errors: [toESBuildError(e as SyntaxError)] }
        }

        const errors = compiledScript.warnings?.map(e => toESBuildError(e)) || [];
        if (errors.length > 0) return { errors };

        // for `sfc-template` loader, and patch* hooks
        // will also update sfcCacheItem.compiledScript
        provideCompiledScript(null, compiledScript);

        // bundler allows injecting code for compiled <script>
        // and beware user MAY modify `compiledScript` in this hook
        await instance.options.patchCompiledScript?.({
          ...sfcCacheItem,
          compiledScript,
        })

        // finally concat code
        let codePrefix = '';
        let codeSuffix = '\nexport default ' + COMP_IDENTIFIER;
        if (hasJSX) {
          codePrefix += '/** @jsx vueH */\n/** @jsxFrag vueFragment */\nimport { h as vueH, Fragment as vueFragment } from "vue";\n';
        }

        // add source map
        const map = { ...compiledScript.map }
        if (map.mappings) {
          map.mappings = ';'.repeat(countChar(codePrefix, '\n')) + map.mappings
          codeSuffix += '\n\n//# sourceMappingURL=data:application/json;base64,' + toBase64(JSON.stringify(map))
        }

        let esbuildLoader: esbuild.Loader = 'js';
        if (hasTS) esbuildLoader = 'ts';
        if (hasJSX) esbuildLoader = (esbuildLoader + 'x') as 'jsx' | 'tsx';

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: codePrefix + compiledScript.content + codeSuffix,
          loader: esbuildLoader,
          watchFiles: [filename],
          pluginData: { ...args.pluginData }
        })
      })

      build.onLoad({ filter: /.vue$/ }, async (args) => {
        const fs = bundler.fs;
        const filename = args.path;
        const encPath = args.path.replace(/\\/g, "\\\\");
        const code = await new Promise<string>((res) => {
          fs.readFile(filename, 'utf8', (err, data) => {
            if (err) res(''); else res(data);
          })
        });
        if (!code) return; // failed to read file

        // prepare common infos

        const id = stringHash(filename).toString(36);
        const { errors, descriptor } = compiler.parse(code, {
          filename: filename,
          sourceMap: true,
        });

        const sfcCacheItem: VueSfcCacheItem = {
          filePath: filename,
          descriptor,
          sfcPraseErrors: errors,
          COMP_IDENTIFIER,
          scopeId: undefined, // will be filled later
          hmrId: undefined, // will be filled later
          compiledScript: undefined, // will be filled later
        }
        instance.sfcCache.set(filename, sfcCacheItem);

        const toESBuildError = makeToEsBuildErrorFunction({
          currentFile: descriptor.filename,
          offsetToPosition: (offset: number) => offsetToPosition(code, offset),
        })

        if (errors.length > 0) return {
          contents: code,
          errors: errors.map(e => toESBuildError(e))
        };

        // ----------------------------------------------
        // sfc-template might need to know `bindingMetadata` from `scriptSetup`
        // so provide a Promise via pluginData, and a updater function

        let provideCompiledScript!: VuePluginMiddleData['provideCompiledScript']
        let compiledScriptPromise: VuePluginMiddleData['compiledScriptPromise'] = new Promise((res, rej) => {
          provideCompiledScript = (err, data) => {
            sfcCacheItem.compiledScript = data;
            if (err) rej(err)
            else res(data!)
          }
        })

        // ----------------------------------------------
        // prepare infos for template, script and style

        const hasScopedStyle = descriptor.styles.some(s => s.scoped);
        const scopeId = hasScopedStyle ? `data-v-${id}` : null;
        if (scopeId) sfcCacheItem.scopeId = scopeId;

        const hasJSX = descriptor.script?.lang?.includes('x') || descriptor.scriptSetup?.lang?.includes('x');
        const hasTS = descriptor.script?.lang?.includes('ts') || descriptor.scriptSetup?.lang?.includes('ts');

        const expressionPlugins: compiler.CompilerOptions['expressionPlugins'] = [];
        if (hasJSX) expressionPlugins.push('jsx');
        if (hasTS) expressionPlugins.push('typescript');

        // ----------------------------------------------
        // entry file
        //
        // the final entry file (xxx.vue) will be look like this:
        //
        // import __vue_component__ from "/src/xxx.vue?type=script";
        // import __render from "/src/xxx.vue?type=template";
        // import "/src/xxx.vue?type=style&index=0";
        //
        // __vue_component__.render = __render;
        // __vue_component__.__hmrId = "xxx.vue";
        // __vue_component__.__scopeId = "data-v-xxxxxx";
        // export default __vue_component__
        //

        let outCodeParts: string[] = [];

        // script block & script setup block (will be merged into one)
        if (descriptor.script || descriptor.scriptSetup) {
          const src = (descriptor.script && !descriptor.scriptSetup && descriptor.script.src) || (`${encPath}?type=script`)
          outCodeParts.push(
            `import ${COMP_IDENTIFIER} from "${src}";`,
          );
        } else {
          outCodeParts.push(
            `const ${COMP_IDENTIFIER} = {};`
          )
          provideCompiledScript(null, undefined); // no script block, so no compiledScript
        }

        // styles
        for (let index = 0; index < descriptor.styles.length; index++) {
          outCodeParts.push(`import "${encPath}?type=style&index=${index}";`);
        }

        // template (note: if `inlineTemplate=true` and `scriptSetup` exists, it will be handled later by `scriptSetup`)
        const templateDescriptor = descriptor.template;
        const templateCompileOptions: compiler.SFCTemplateCompileOptions | false = !!templateDescriptor && {
          isProd,
          id,
          ast: templateDescriptor.ast,
          source: templateDescriptor.content,
          filename: descriptor.filename,
          scoped: hasScopedStyle,
          slotted: descriptor.slotted,
          // transformAssetUrls
          // preprocessLang
          // preprocessOptions
          compilerOptions: await invokeOptionsPatcher(
            instance.options.templateCompilerOptions,
            {
              filename,
              // bindingMetadata: descriptor.scriptSetup?.bindings, // yet no data, will be filled later.
              scopeId,
              expressionPlugins,
              // sourceMap: true,
              hmr: !!instance.options.hmr,
            },
            descriptor
          ),
        }
        if (templateCompileOptions && (!instance.options.inlineTemplate || !descriptor.scriptSetup)) {
          outCodeParts.push(
            `import { render as ___render } from "${encPath}?type=template";`,
            `${COMP_IDENTIFIER}.render = ___render`,
          );
        }

        // hmr
        let hmrId = instance.options.hmr && String(await instance.options.hmrId(filename));
        if (hmrId) {
          sfcCacheItem.hmrId = hmrId;
          const hmrIdEscaped = JSON.stringify(hmrId)
          outCodeParts.push(
            `${COMP_IDENTIFIER}.__hmrId = ${hmrIdEscaped};`,
            `typeof __VUE_HMR_RUNTIME__ !== 'undefined' && __VUE_HMR_RUNTIME__.createRecord(${hmrIdEscaped}, ${COMP_IDENTIFIER});`,
          );
        }

        // misc
        if (scopeId) outCodeParts.push(
          `${COMP_IDENTIFIER}.__scopeId = ${JSON.stringify(scopeId)}`
        );
        outCodeParts.push(
          `${COMP_IDENTIFIER}.__file = ${JSON.stringify(filename)}`
        );

        // inject sfc runtime
        const extraInject = await instance.options.injectSFCRuntime(sfcCacheItem);
        if (extraInject) outCodeParts.push(extraInject);

        outCodeParts.push(
          `export default ${COMP_IDENTIFIER}`
        )

        // ----------------------------------------------
        // emit entry file, and the imports will be handled by other loaders

        const vuePluginMiddleData: VuePluginMiddleData = {
          descriptor,
          templateCompileOptions,
          id,
          scopeId: scopeId || undefined,
          hmrId: hmrId || undefined,
          hasJSX: !!hasJSX,
          hasTS: !!hasTS,
          toESBuildError,
          sfcCacheItem,
          compiledScriptPromise,
          provideCompiledScript,
        }

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: outCodeParts.join('\n'),
          loader: 'js',
          watchFiles: [filename],
          pluginData: {
            vue: vuePluginMiddleData
          }
        })
      })
    }
  }

  instance.plugin = plugin;
  bundler.userCodePlugins.push(plugin); // vendor? not care for now.

  return instance;
}

/** 
 * when first .vue loader returns,
 * it will pass this via esbuild's `pluginData.vue` to 
 * other loaders like sfc-script and sfc-style.
 */
interface VuePluginMiddleData {
  descriptor: compiler.SFCDescriptor;
  templateCompileOptions: compiler.SFCTemplateCompileOptions | false;
  id: string;
  scopeId: string | undefined;
  hmrId: string | undefined;
  toESBuildError: ReturnType<typeof makeToEsBuildErrorFunction>;
  hasJSX: boolean;
  hasTS: boolean;
  sfcCacheItem: VueSfcCacheItem;

  compiledScriptPromise: Promise<compiler.SFCScriptBlock | undefined>;
  provideCompiledScript: { // invoked by `scriptSetup`
    (err: Error | null | undefined, data: compiler.SFCScriptBlock | undefined): void
  }
}

const getPreprocessCustomRequireWithSass = memoAsync(async () => {
  const sass = await import('sass');

  const sassCompile = (opts: { data: string, file: string, indentedSyntax?: boolean }) => {
    const out = sass.compileString(opts.data, {
      syntax: opts.indentedSyntax ? 'indented' : 'scss',
    });
    return {
      css: out.css,
      map: out.sourceMap || '',
      stats: {
        includedFiles: out.loadedUrls,
      },
    };
  }

  const preprocessCustomRequire = (id: string) => {
    if (id === 'sass') return { renderSync: sassCompile };
    return null;
  };

  return preprocessCustomRequire as (id: string) => any
})

export type MaybePromise<T> = T | Promise<T>;
export type OptionsPatcher<T extends object, ARGS extends any[]> = ((initial: T, ...args: ARGS) => T | Promise<T>) | null | undefined | Partial<T>;
async function invokeOptionsPatcher<T extends object, ARGS extends any[]>(userCfg: OptionsPatcher<T, ARGS>, initial: T, ...args: ARGS) {
  if (!userCfg) return initial;
  if (typeof userCfg === 'function') return await userCfg(initial, ...args);
  return { ...initial, ...userCfg };
}

function getFullPath(args: esbuild.OnResolveArgs) {
  let filePath = stripQuery(args.path);
  return path.isAbsolute(filePath) ? filePath : path.join(args.resolveDir || path.dirname(args.importer), filePath);
}

function getUrlParams(search: string): Record<string, string> {
  let hashes = search.slice(search.indexOf('?') + 1).split('&')
  return hashes.reduce((params, hash) => {
    let [key, val] = hash.split('=')
    return Object.assign(params, { [key]: decodeURIComponent(val || '') })
  }, {})
}


type BabelSyntaxError = Error & { loc: { line: number, column: number, index: number, source: undefined } }

/**
 * generate a function that convert vue or babel error to esbuild error.
 */
function makeToEsBuildErrorFunction(ctx: {
  offsetToPosition?: (offset: number) => { line: number; column: number; lineText?: string; };
  currentFile: string;
}) {
  function toESBuildError(
    e: string | SyntaxError | compiler.CompilerError | BabelSyntaxError
  ): esbuild.PartialMessage {
    if (typeof e === 'string') return { text: e };

    if (e instanceof Error) {
      if ('loc' in e && e.loc) {
        let start: Position, end: Position;

        if ('start' in e.loc) {
          // vue error
          start = e.loc.start;
          end = e.loc.end || start;
        } else {
          // babel error
          end = start = { line: e.loc.line, column: e.loc.column, offset: e.loc.index };
        }

        const locator = ctx.offsetToPosition?.(start.offset) || { line: start.line, column: start.column };
        return {
          text: e.message,
          location: {
            file: e.loc.source || ctx.currentFile,
            ...locator,
            length: end.offset - start.offset,
          },
        };
      };
      return { text: e.message };
    }

    return { text: String(e) };
  };

  toESBuildError.ctx = ctx;
  return toESBuildError;
}
