import { stringHash } from 'yon-utils';
import * as compiler from 'vue/compiler-sfc';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";
import path from "path";
import { memoAsync } from '../utils.js';

const COMP_IDENTIFIER = '__vue_component__';
function getFullPath(args: esbuild.OnResolveArgs) {
  return path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path);
}

function getUrlParams(search: string): Record<string, string> {
  let hashes = search.slice(search.indexOf('?') + 1).split('&')
  return hashes.reduce((params, hash) => {
    let [key, val] = hash.split('=')
    return Object.assign(params, { [key]: decodeURIComponent(val) })
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

function toESBuildError(
  e: string | SyntaxError | compiler.CompilerError,
  ctx: {
    offsetToPosition?: (offset: number) => { line: number, column: number, lineText?: string }
    currentFile: string
  }
): esbuild.PartialMessage {
  if (typeof e === 'string') return { text: e };

  if (e instanceof Error) {
    if ('loc' in e && e.loc) {
      const locator = ctx.offsetToPosition?.(e.loc.start.offset) || { line: e.loc.start.line, column: e.loc.start.column }
      return {
        text: e.message,
        location: {
          file: e.loc.source || ctx.currentFile,
          ...locator,
          length: e.loc.end.offset - e.loc.start.offset,
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
}

export default function installVuePlugin(bundler: BundlerInBrowser, opts: InstallVuePluginOptions = {}) {
  const vendorPlugin: esbuild.Plugin = {
    name: "vue-loader-vendor",
    setup(build) {
      build.initialOptions.define = {
        "__VUE_OPTIONS_API__": opts.disableOptionsApi ? "false" : "true",
        "__VUE_PROD_DEVTOOLS__": opts.enableProdDevTools ? "true" : "false",
        "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": opts.enableHydrationMismatchDetails ? "true" : "false",
        ...build.initialOptions.define,
      }
    }
  }

  const plugin: esbuild.Plugin = {
    name: "vue-loader",
    setup(build) {
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
            text: 'style: ' + e.reason,
            location: {
              file: toESBuildErrorCtx.currentFile,
              line: e.line - 1 + style.loc.start.line,
              column: e.column - 1,
              lineText: getLineText(e.source, e.line),
            }
          }))
        };

        return {
          contents: code,
          loader: 'css',
          pluginData: { ...args.pluginData }
        }
      })

      build.onLoad({ filter: /./, namespace: "sfc-script" }, async (args) => {
        const descriptor = args.pluginData.vue.descriptor as compiler.SFCDescriptor;
        const { id, scopeId, expressionPlugins, toESBuildErrorCtx, esbuildLoader, hasJSX } = args.pluginData.vue;

        const filename = descriptor.filename;
        const compiledScript = compiler.compileScript(descriptor, {
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

        const errors = compiledScript.warnings?.map(e => toESBuildError(e, toESBuildErrorCtx)) || [];
        if (errors.length > 0) return { errors };

        let codePrefix = '';
        if (hasJSX) {
          codePrefix += '/** @jsx vueH */\n/** @jsxFrag vueFragment */\nimport { h as vueH, Fragment as vueFragment } from "vue";\n';
        }

        return {
          contents: codePrefix + compiledScript.content + '\n\nexport default ' + COMP_IDENTIFIER,
          loader: esbuildLoader,
          watchFiles: [filename],
          pluginData: { ...args.pluginData }
        }
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

        return {
          contents: outCodeParts.join('\n'),
          loader,
          watchFiles: [filename],
          pluginData: {
            vue: { descriptor, id, scopeId, expressionPlugins, toESBuildErrorCtx, esbuildLoader: loader, hasTS, hasJSX }
          }
        }
      })
    }
  }

  bundler.userCodePlugins.push(plugin);
  bundler.vendorPlugins.push(vendorPlugin);
}

const getPreprocessCustomRequireWithSass = memoAsync(async () => {
  const sass = await import('sass');

  const sassCompile = (opts: { data: string, file: string }) => {
    const out = sass.compileString(opts.data, {
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
    if (id === 'sass' || id === 'scss') return { renderSync: sassCompile };
    return null;
  };

  return preprocessCustomRequire as (id: string) => any
})
