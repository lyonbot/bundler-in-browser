import postcss from 'postcss';
import { createTailwindcssPlugin, type Content, type TailwindConfig } from '@mhsdesign/jit-browser-tailwindcss'
import { wrapCommonJS, type BundlerInBrowser } from 'bundler-in-browser';
import type esbuild from 'esbuild-wasm';
import autoprefixer from 'autoprefixer';

import * as tailwindGoods from './goods/index.js';
export { tailwindGoods };

const defaultPattern = /\.(css|scss|sass|less|styl|html|vue|jsx?|tsx?|[cm][jt]s)|md$/;

export default function installTailwindPlugin(bundler: BundlerInBrowser, options?: {
  /** 
   * the tailwind config. defaults to {} 
   * 
   * note: can be a file path like "/src/tailwind.config.js" - but is dangerous cause we use `eval` to load it.
   * 
   * ( still recommended to pass an object here! )
   */
  tailwindConfig?: TailwindConfig | string,

  /** defaults to '/src' */
  rootDir?: string,

  /** files to scan. defaults to html,md,css,ts,js,vue,jsx,tsx etc. */
  pattern?: RegExp,
}) {
  const pattern = options?.pattern || defaultPattern;
  if (!(pattern instanceof RegExp)) throw new Error('pattern must be a RegExp');

  let rootDir = (options?.rootDir || '/src').replace(/\/+$/, '');
  if (!rootDir) rootDir = '/';
  if (!rootDir.startsWith('/')) throw new Error('rootDir must start with /');

  let processor: postcss.Processor;
  bundler.config.postProcessors.push({
    name: "tailwindcss",
    test: /\.(s[ac]ss|css)$/i,
    process: async (args, result) => {
      const filePath = args.path;
      const content = bundler.pluginUtils.contentsToString(result.contents);

      try {
        const postcssResult = await processor.process(content, {
          from: filePath,
          map: { inline: false, annotation: false }
        });
        applyPostcssResult(postcssResult, filePath, result);
      } catch (e) {
        applyPostcssError(e, filePath, result);
        throw new Error(`PostCSS error in ${filePath}`);
      }
    }
  })

  const plugin: esbuild.Plugin = {
    name: "tailwindcss",
    setup(build) {
      const fs = bundler.fs;
      processor = postcss();

      build.onStart(async () => {
        await readyPromise;
      });

      const readyPromise = (async () => {
        const content = [] as Content[];

        // console.log('tailwindcssPlugin: start scanning...');
        const toScanDirs = [rootDir];
        while (toScanDirs.length > 0) {
          const dir = toScanDirs.shift()!;
          try {
            for (const name of fs.readdirSync(dir)) {
              const path = `${dir}/${name}`;
              if (!pattern.test(path)) {
                toScanDirs.push(path);
                continue;
              }

              try {
                const ext = name.split('.').pop();
                const file = fs.readFileSync(path, 'utf-8') as string;
                content.push({ extension: ext, content: file });
              } catch {
                // maybe not a file.
                toScanDirs.push(path);
              }
            }
          } catch {
            // cannot readdir, skip
          }
        }
        // console.log('tailwindcssPlugin: scanning done. file count = ' + scanCount);

        let tailwindConfig: TailwindConfig = {};
        {
          const raw = options?.tailwindConfig;
          if (typeof raw === 'object' && raw !== null) {
            tailwindConfig = raw;
          } else if (typeof raw === 'string') {
            // dangerously use eval to load the config
            let configSource = fs.readFileSync(raw, 'utf-8') as string;
            tailwindConfig = new Function('return ' + wrapCommonJS(configSource))();
            if (typeof tailwindConfig !== 'object' || tailwindConfig === null) {
              throw new Error(`Tailwind config must be an object: ${raw}`);
            }
          }
        }

        const tailwindcssPlugin = createTailwindcssPlugin({
          tailwindConfig,
          content,
        });

        processor.use(autoprefixer);
        processor.use(tailwindcssPlugin);
      })();
    }
  }

  bundler.userCodePlugins.push(plugin);
}

function applyPostcssResult(postcssResult: postcss.Result, filePath: string, result: esbuild.OnLoadResult) {
  result.contents = postcssResult.css;
  result.warnings = postcssResult.warnings().map(w => ({
    text: w.text,
    location: {
      file: filePath,
      line: w.line,
      column: w.column,
    },
    detail: w,
  }))
}

function applyPostcssError(error: any, filePath: string, result: esbuild.OnLoadResult) {
  const postcssError = error as {
    name: string;
    message: string;
    reason: string;
    file?: string;
    line?: number;
    column?: number;
  };

  result.errors = [{
    text: `[PostCSS ${postcssError.name}] ${postcssError.message}`,
    location: {
      file: filePath,
      line: postcssError.line,
      column: postcssError.column,
    }
  }]
}
