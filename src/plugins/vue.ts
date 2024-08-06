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

function toESBuildError(e: string | SyntaxError | compiler.CompilerError): esbuild.PartialMessage {
  if (typeof e === 'string') return { text: e };

  if (e instanceof Error) {
    if ('loc' in e && e.loc) return {
      text: e.message,
      location: {
        file: e.loc.source,
        line: e.loc.start.line,
        column: e.loc.start.column
      },
    };
    return { text: e.message };
  }

  return { text: String(e) }
}

export default function installVuePlugin(bundler: BundlerInBrowser, opts: {
  disableOptionsApi?: boolean;
  enableDevTools?: boolean;
  enableHydrationMismatchDetails?: boolean;
} = {}) {
  const vendorPlugin: esbuild.Plugin = {
    name: "vue-loader-vendor",
    setup(build) {
      build.initialOptions.define = {
        ...build.initialOptions.define,
        "__VUE_OPTIONS_API__": opts.disableOptionsApi ? "false" : "true",
        "__VUE_PROD_DEVTOOLS__": opts.enableDevTools ? "true" : "false",
        "__VUE_PROD_HYDRATION_MISMATCH_DETAILS__": opts.enableHydrationMismatchDetails ? "true" : "false",
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
        if (errors.length > 0) return { errors: errors.map(toESBuildError) };

        return {
          contents: code,
          loader: 'css',
          pluginData: { ...args.pluginData }
        }
      })

      build.onLoad({ filter: /./, namespace: "sfc-script" }, async (args) => {
        const descriptor = args.pluginData.vue.descriptor as compiler.SFCDescriptor;
        const { id, scopeId, expressionPlugins } = args.pluginData.vue;

        const filename = descriptor.filename;
        const compiledScript = compiler.compileScript(descriptor, {
          inlineTemplate: true,
          id,
          genDefaultAs: COMP_IDENTIFIER,
          templateOptions: {
            ast: descriptor.template?.ast,
            compilerOptions: {
              filename,
              scopeId,
              expressionPlugins,
            },
          },
        });

        const errors = compiledScript.warnings?.map(toESBuildError) || [];
        if (errors.length > 0) return { errors };

        return {
          contents: compiledScript.content + '\n\nexport default ' + COMP_IDENTIFIER,
          loader: 'js',
          watchFiles: [filename],
          pluginData: { ...args.pluginData }
        }
      })

      build.onLoad({ filter: /.vue$/ }, async (args) => {
        const fs = bundler.fs;
        const filename = args.path;
        const encPath = args.path.replace(/\\/g, "\\\\");
        const code = await fs.promises.readFile(filename, 'utf8') as string;

        const id = stringHash(filename).toString(36);
        const { errors, descriptor } = compiler.parse(code, {
          filename: filename,
          sourceMap: true,
        });

        if (errors.length > 0) return { errors: errors.map(toESBuildError) };

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
          if (errors.length > 0) return { errors: errors.map(toESBuildError) };

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

        return {
          contents: outCodeParts.join('\n'),
          loader: 'js',
          watchFiles: [filename],
          pluginData: {
            vue: { descriptor, id, scopeId, expressionPlugins }
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
