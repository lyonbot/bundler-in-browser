import { stringHash } from 'yon-utils';
import * as compiler from 'vue/compiler-sfc';
import { type Position } from '@vue/compiler-core';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";
import path from "path";
import { memoAsync, stripQuery } from '../utils/index.js';

const COMP_IDENTIFIER = '__vue_component__';
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

function getLineContent(code: string, offset: number) {
  let lineStart = 0;
  let line = 1;
  let lineEnd = code.length;

  while (true) {
    lineEnd = code.indexOf('\n', lineStart);

    if (lineEnd === -1) { lineEnd = code.length; break; }
    if (offset <= lineEnd) break;

    line++;
    lineStart = lineEnd + 1;
  }

  return {
    line,
    column: offset - lineStart,
    lineText: code.slice(lineStart, lineEnd)
  }
}

/**
 * @param source 
 * @param line start from 1
 * @returns 
 */
function getLineText(source: string, line: number) {
  if (!source || !(line >= 1)) return '';

  let lineStart = 0;
  let lineEnd = source.length;

  while (true) {
    lineEnd = source.indexOf('\n', lineStart);

    if (lineEnd === -1) { lineEnd = source.length; break; }
    if (line <= 1) break;

    line--;
    lineStart = lineEnd + 1;
  }

  return source.slice(lineStart, lineEnd)
}

type BabelSyntaxError = Error & { loc: { line: number, column: number, index: number, source: undefined } }

function toESBuildError(
  e: string | SyntaxError | compiler.CompilerError | BabelSyntaxError,
  ctx: {
    offsetToPosition?: (offset: number) => { line: number, column: number, lineText?: string }
    currentFile: string
  }
): esbuild.PartialMessage {
  if (typeof e === 'string') return { text: e };

  if (e instanceof Error) {
    if ('loc' in e && e.loc) {
      let start: Position, end: Position

      if ('start' in e.loc) {
        // vue error
        start = e.loc.start
        end = e.loc.end || start
      } else {
        // babel error
        end = start = { line: e.loc.line, column: e.loc.column, offset: e.loc.index }
      }

      const locator = ctx.offsetToPosition?.(start.offset) || { line: start.line, column: start.column }
      return {
        text: e.message,
        location: {
          file: e.loc.source || ctx.currentFile,
          ...locator,
          length: end.offset - start.offset,
        },
      }
    };
    return { text: e.message };
  }

  return { text: String(e) }
}

export interface InstallVuePluginOptions {
  disableOptionsApi?: boolean;
  enableProdDevTools?: boolean;
  enableHydrationMismatchDetails?: boolean;

  /** whether inject HMR related code `__VUE_HMR_RUNTIME__.createRecord(hmrId, sfcMain)` */
  hmr?: boolean;

  /** 
   * custom HMR id generator. works with `hmr: true`.
   * 
   * defaults to `filePath => filePath` */
  hmrId?: (filePath: string) => string | Promise<string>;
}

export interface VuePluginInstance {
  options: Required<InstallVuePluginOptions>;
  plugin: esbuild.Plugin;
}

export default function installVuePlugin(bundler: BundlerInBrowser, opts: InstallVuePluginOptions = {}) {
  const instance: VuePluginInstance = {
    options: {
      disableOptionsApi: false,
      enableProdDevTools: false,
      enableHydrationMismatchDetails: false,
      hmr: false,
      hmrId: (filePath: string) => filePath,
      ...opts,
    },
    plugin: null as unknown as esbuild.Plugin, // assign later
  };

  const plugin: esbuild.Plugin = {
    name: "vue-loader",
    setup(build) {
      const opts = instance.options;
      build.initialOptions.define = {
        "__VUE_OPTIONS_API__": opts.disableOptionsApi ? "false" : "true",
        "__VUE_PROD_DEVTOOLS__": opts.enableProdDevTools ? "true" : "false",
        "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": opts.enableHydrationMismatchDetails ? "true" : "false",
        ...build.initialOptions.define,
      }

      const isProd = build.initialOptions.minify !== false;

      // Resolve main ".vue" import
      build.onResolve({ filter: /\.vue/ }, async (args) => {
        const params = getUrlParams(args.path);

        let namespace = 'file';
        if (params.type === "script") namespace = "sfc-script";
        // else if (params.type === "template") namespace = "sfc-template"; // yet integrated in `.vue` onLoad
        else if (params.type === "style") namespace = "sfc-style";

        return {
          path: getFullPath(args),
          namespace,
          pluginData: {
            ...args.pluginData,
            index: params.index,
          }
        }
      });

      build.onLoad({ filter: /./, namespace: "sfc-style" }, async (args) => {
        const descriptor = args.pluginData.vue.descriptor as compiler.SFCDescriptor;
        const id = args.pluginData.vue.id;
        const toESBuildErrorCtx = args.pluginData.vue.toESBuildErrorCtx;
        const style = descriptor.styles[args.pluginData.index];

        const preprocessCustomRequire = /s[ac]ss/.test(style.lang!) ? await getPreprocessCustomRequireWithSass() : undefined

        // TODO: "style.module" not supported yet

        const { code, errors: errorsAll } = await compiler.compileStyleAsync({
          filename: descriptor.filename,
          id: id,
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
              file: toESBuildErrorCtx.currentFile,
              ...e.line >= 1 ? {   // for css
                line: e.line - 1 + style.loc.start.line,
                column: e.column - 1,
                lineText: getLineText(e.source, e.line),
              } : null,
              ...e.sassStack && e.span ? {   // for sass
                ...toESBuildErrorCtx.offsetToPosition?.(e.span.start.offset + style.loc.start.offset),
              } : null,
            }
          }))
        };

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: code,
          loader: 'css',
          pluginData: { ...args.pluginData }
        })
      })

      build.onLoad({ filter: /./, namespace: "sfc-script" }, async (args) => {
        const descriptor = args.pluginData.vue.descriptor as compiler.SFCDescriptor;
        const { id, scopeId, expressionPlugins, toESBuildErrorCtx, esbuildLoader, hasJSX } = args.pluginData.vue;

        const filename = descriptor.filename;
        let compiledScript: ReturnType<typeof compiler.compileScript>;
        try {
          compiledScript = compiler.compileScript(descriptor, {
            inlineTemplate: true,
            id,
            genDefaultAs: COMP_IDENTIFIER,
            fs: {
              fileExists: (file) => bundler.fs.existsSync(file),
              readFile: (file) => { try { return bundler.fs.readFileSync(file, 'utf8') as string; } catch { } },
              realpath: (file) => bundler.fs.realpathSync(file, { encoding: 'utf8' }) as string,
            },
            templateOptions: {
              ast: descriptor.template?.ast,
              compilerOptions: {
                filename,
                scopeId,
                expressionPlugins,
              },
            },
          });
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
          return { errors: [toESBuildError(e as SyntaxError, toESBuildErrorCtx)] }
        }

        const errors = compiledScript.warnings?.map(e => toESBuildError(e, toESBuildErrorCtx)) || [];
        if (errors.length > 0) return { errors };

        let codePrefix = '';
        if (hasJSX) {
          codePrefix += '/** @jsx vueH */\n/** @jsxFrag vueFragment */\nimport { h as vueH, Fragment as vueFragment } from "vue";\n';
        }

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: codePrefix + compiledScript.content + '\n\nexport default ' + COMP_IDENTIFIER,
          loader: esbuildLoader,
          watchFiles: [filename],
          pluginData: { ...args.pluginData }
        })
      })

      build.onLoad({ filter: /.vue$/ }, async (args) => {
        const fs = bundler.fs;
        const filename = args.path;
        const encPath = args.path.replace(/\\/g, "\\\\");
        const code = fs.readFileSync(filename, 'utf8') as string;

        const id = stringHash(filename).toString(36);
        const { errors, descriptor } = compiler.parse(code, {
          filename: filename,
          sourceMap: true,
        });

        const toESBuildErrorCtx: Parameters<typeof toESBuildError>[1] = {
          currentFile: descriptor.filename,
          offsetToPosition: (offset: number) => getLineContent(code, offset),
        }
        if (errors.length > 0) return {
          contents: code,
          errors: errors.map(e => toESBuildError(e, toESBuildErrorCtx))
        };

        const hasScopedStyle = descriptor.styles.some(s => s.scoped);
        const scopeId = hasScopedStyle ? `data-v-${id}` : null;

        const hasJSX = descriptor.script?.lang?.includes('x') || descriptor.scriptSetup?.lang?.includes('x');
        const hasTS = descriptor.script?.lang?.includes('ts') || descriptor.scriptSetup?.lang?.includes('ts');

        const expressionPlugins: compiler.CompilerOptions['expressionPlugins'] = [];
        if (hasJSX) expressionPlugins.push('jsx');
        if (hasTS) expressionPlugins.push('typescript');

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
        }

        // styles
        for (let index = 0; index < descriptor.styles.length; index++) {
          outCodeParts.push(`import "${encPath}?type=style&index=${index}";`);
        }

        // template (note: if `scriptSetup` exists, it will be compiled by `scriptSetup`)
        if (descriptor.template && !descriptor.scriptSetup) {
          const { code: rawCode, errors } = compiler.compileTemplate({
            isProd,
            id,
            ast: descriptor.template.ast,
            source: descriptor.template.content,
            filename: descriptor.filename,
            scoped: hasScopedStyle,
            slotted: descriptor.slotted,
            compilerOptions: {
              filename,
              expressionPlugins,
            },
          });
          if (errors.length > 0) return { errors: errors.map(e => toESBuildError(e, toESBuildErrorCtx)) };

          outCodeParts.push(
            rawCode.replace(/\nexport (function|const) (render|ssrRender)/, '$1 ___render'),
            `${COMP_IDENTIFIER}.render = ___render`,
          );
        }

        // hmr
        if (instance.options.hmr) {
          const hmrIdEscaped = JSON.stringify(String(await instance.options.hmrId(filename)))
          outCodeParts.push(
            `${COMP_IDENTIFIER}.__hmrId = ${hmrIdEscaped};`,
            `typeof __VUE_HMR_RUNTIME__ !== 'undefined' && __VUE_HMR_RUNTIME__.createRecord(${hmrIdEscaped}, ${COMP_IDENTIFIER});`,
          );
        }

        // misc
        {
          if (scopeId) outCodeParts.push(`${COMP_IDENTIFIER}.__scopeId = ${JSON.stringify(scopeId)}`);

          outCodeParts.push(
            `${COMP_IDENTIFIER}.__file = ${JSON.stringify(filename)}`,
            `export default ${COMP_IDENTIFIER}`
          );
        }

        let loader: esbuild.Loader = 'js';
        if (hasTS) loader = 'ts';
        if (hasJSX) loader = (loader + 'x') as 'jsx' | 'tsx';

        return await bundler.pluginUtils.applyPostProcessors(args, {
          contents: outCodeParts.join('\n'),
          loader,
          watchFiles: [filename],
          pluginData: {
            vue: { descriptor, id, scopeId, expressionPlugins, toESBuildErrorCtx, esbuildLoader: loader, hasTS, hasJSX }
          }
        })
      })
    }
  }

  instance.plugin = plugin;
  bundler.commonPlugins.push(plugin);

  return instance;
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
