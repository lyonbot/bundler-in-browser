import './dirty-stuff/monkey-patch.js';

import esbuild from "esbuild-wasm";
import esbuildWasm from "esbuild-wasm/esbuild.wasm?url";
import { create as createResolver, type ResolveContext } from 'enhanced-resolve'
import { type IFs } from "memfs";
import { MiniNPM } from "./npm.js";
import { decodeUTF8 } from './utils.js';

let initPromise: Promise<void> | undefined;

export class BundlerInBrowser {
  public fs: IFs;
  public plugins: esbuild.Plugin[];

  async initialize() {
    if (!initPromise) {
      initPromise = esbuild.initialize({
        wasmURL: esbuildWasm
        // wasmModule: await WebAssembly.compileStreaming(fetch('/node_modules/esbuild-wasm/esbuild.wasm'))
        // wasmURL: "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.23.0/esbuild.wasm",
      });
    }
    await initPromise;
  }

  constructor(fs: IFs) {
    this.fs = fs;
    this.plugins = []

    const installResolvePlugin = () => {
      const fs = this.fs;
      const resolve = createResolver({
        fileSystem: fs as any,
        extensions: ['.js', '.mjs', '.cjs', '.json', '.wasm', '.ts', '.tsx', '.jsx', '.vue'],
        conditionNames: ['import', 'require'],
      })

      this.plugins.push({
        name: "resolve",
        setup(build) {
          build.onResolve({ filter: /.*/ }, async (args) => {
            let fullPath = args.path;
            if (/^(https?:)\/\//.test(fullPath)) return { external: true, path: fullPath }; // URL is external

            return await new Promise((done, reject) => {
              resolve(args.resolveDir, fullPath, (err, res) => {
                if (err) return reject(err);
                if (!res) return reject(new Error(`Cannot resolve ${fullPath}`));

                else done({ path: res });
              })
            });
          });
        },
      });
    }
    const installNpmInstallPlugin = () => {
      const npm = new MiniNPM(fs);
      this.plugins.push({
        name: 'npm-installer',
        setup(build) {
          build.onResolve({ filter: /^[a-zA-Z].*|^@\w+\/.*/ }, async (args) => {
            let fullPath = args.path
            let fullPathSplitted = fullPath.split('/', 2);

            let packageName = fullPath[0] === '@' ? fullPathSplitted.join('/') : fullPathSplitted[0];
            await npm.install(packageName)

            return null
          })
        }
      })
    }
    const installSassLoaderPlugin = () => {
      this.plugins.push({
        name: "sass-loader",
        setup(build) {
          build.onLoad({ filter: /.scss$/ }, async (args) => {
            const sass = await import('sass');

            let fullPath = args.path;
            let contents = fs.readFileSync(fullPath).toString('utf8');
            let result = await sass.compileStringAsync(contents, {
              style: 'expanded'
            });

            return {
              contents: result.css,
              loader: fullPath.endsWith('.module.scss') ? 'local-css' : 'css'
            }
          })
        }
      })
    }
    const installCommonLoaderPlugin = () => {
      const builtinLoaders = ['js', 'jsx', 'tsx', 'ts', 'css', 'json', 'text'] as const
      this.plugins.push({
        name: "common-loader",
        setup(build) {
          build.onLoad({ filter: /\.([mc]?jsx?|tsx?|css|json|txt)$/ }, async (args) => {
            let fullPath = args.path;
            let suffix = fullPath.split('.').pop()!;
            let loader: esbuild.Loader = 'js';

            if (builtinLoaders.includes(suffix as any)) loader = suffix as typeof builtinLoaders[number];
            else if (suffix === 'txt') loader = 'text';
            else if (suffix === 'cjs' || suffix === 'mjs') loader = 'js';

            if (loader === 'css' && fullPath.endsWith('.module.css')) loader = 'local-css';

            return {
              contents: fs.readFileSync(fullPath),
              loader
            }
          })
        },
      });
    }

    installNpmInstallPlugin();
    installResolvePlugin();
    installSassLoaderPlugin();
    installCommonLoaderPlugin();
  }

  async compile() {
    await this.initialize();
    const result = await esbuild.build({
      entryPoints: ["/index.js"],
      bundle: true,
      write: false,
      outdir: "/dist",
      format: "cjs",
      target: "es2022",
      platform: "browser",
      plugins: this.plugins.slice(),
      sourcemap: false,
    })

    console.log(result);
    return decodeUTF8(result.outputFiles[0].contents);
  }
}

