import './dirty-stuff/monkey-patch.js';

import esbuild from "esbuild-wasm";
import { create as createResolver } from 'enhanced-resolve'
import { type IFs } from "memfs";
import { MiniNPM } from "./npm.js";
import { log, wrapCommonJS } from './utils.js';

export interface VendorBundleResult {
  hash: string; // concat of sorted externalDeps

  externalDeps: string[];
  js: string;  // export `dep${index}`
  css: string;
}

function pathToNpmPackage(fullPath: string): [packageName: string, importedPath: string] {
  let fullPathSplitted = fullPath.split('/', 2);
  let packageName = fullPath[0] === '@' ? fullPathSplitted.join('/') : fullPathSplitted[0];
  let importedPath = fullPath.slice(packageName.length + 1) // remove leading slash

  return [packageName, importedPath];
}

export class BundlerInBrowser {
  public readonly fs: IFs;

  initialized: Promise<void> | false = false;
  private async assertInitialized() {
    if (!this.initialized) throw new Error('BundlerInBrowser not initialized');
    await this.initialized;
  }

  async initialize(opt: { esbuildWasmURL: string | URL }) {
    if (!this.initialized) {
      this.initialized = esbuild.initialize({
        wasmURL: opt.esbuildWasmURL
        // wasmURL: esbuildWasm
        // wasmModule: await WebAssembly.compileStreaming(fetch('/node_modules/esbuild-wasm/esbuild.wasm'))
        // wasmURL: "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.23.0/esbuild.wasm",
      });
    }
    await this.initialized;
  }

  public npmRequired: string[] = [] // only package names
  public externalDeps: string[] = [] // string paths

  public userCodePlugins: esbuild.Plugin[] = [] // only for user code
  public vendorPlugins: esbuild.Plugin[] = [] // only for vendor code
  public commonPlugins: esbuild.Plugin[] = [] // works for both user and vendor, will be appended to user plugins

  constructor(fs: IFs) {
    this.fs = fs;
    this.npm = new MiniNPM(fs);

    const resolvePlugin = (): esbuild.Plugin => {
      const fs = this.fs;
      const resolve = createResolver({
        fileSystem: fs as any,
        extensions: ['.js', '.mjs', '.cjs', '.json', '.wasm', '.ts', '.tsx', '.jsx', '.vue'],
        conditionNames: ['import', 'require'],
      })

      return ({
        name: "resolve",
        setup(build) {
          build.onResolve({ filter: /.*/ }, async (args) => {
            let fullPath = args.path;
            if (/^(https?:)\/\/|^data:/.test(fullPath)) return { external: true, path: fullPath }; // URL is external

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
    const npmCollectPlugin = (): esbuild.Plugin => {
      const { npmRequired, externalDeps } = this
      return ({
        name: 'npm-collect',
        setup(build) {
          build.onResolve({ filter: /^[a-zA-Z].*|^@\w+\/.*/ }, async (args) => {
            let fullPath = args.path
            let [packageName] = pathToNpmPackage(fullPath)

            let npmIndex = npmRequired.indexOf(packageName)
            if (npmIndex === -1) npmIndex = npmRequired.push(packageName) - 1

            let externalDepIndex = externalDeps.indexOf(fullPath)
            if (externalDepIndex === -1) externalDepIndex = externalDeps.push(fullPath) - 1

            return {
              path: fullPath,
              external: true
            }
          })
        }
      })
    }
    const commonLoaderPlugin = (): esbuild.Plugin => {
      const builtinLoaders = ['js', 'jsx', 'tsx', 'ts', 'css', 'json', 'text'] as const
      return ({
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

    this.userCodePlugins.push(
      npmCollectPlugin(),
    )

    this.vendorPlugins.push(
    )

    this.commonPlugins.push(
      resolvePlugin(),
      commonLoaderPlugin(),
    )
  }

  npm: MiniNPM;

  prevVendorBundle: undefined | VendorBundleResult
  async bundleVendor() {
    await this.assertInitialized();

    const externalDeps = Array.from(this.externalDeps)
    const hash = externalDeps.sort().join(',')

    if (this.prevVendorBundle?.hash === hash) return this.prevVendorBundle;

    // wait for all npm installs to finish
    await this.npm.install(Array.from(this.npmRequired));
    throw new Error('stop')

    // create a new bundle
    const vendor: VendorBundleResult = {
      hash,
      externalDeps,
      js: '',
      css: '',
    }

    const workDir = `/vendor_dll`

    let entryPath = `${workDir}/source.js`
    let entryPathRegex = new RegExp(`^${entryPath}$`)
    let entryContent = 'exports.deps = {\n'

    for (let i = 0; i < externalDeps.length; i++) {
      const dep = externalDeps[i];
      entryContent += `"${dep}": require("${dep}"),\n`
    }
    entryContent += '};'

    const buildOutput = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      outdir: workDir,
      write: false,
      format: "cjs",
      target: "es2022",
      platform: "browser",
      plugins: [
        {
          name: 'vendor-entry',
          setup(build) {
            build.onResolve({ filter: entryPathRegex }, (args) => {
              return { path: entryPath }
            })
            build.onLoad({ filter: entryPathRegex }, (args) => {
              if (args.path === entryPath) return { contents: entryContent, loader: 'js' };
              return null
            })
          }
        },
        ...this.vendorPlugins,
        ...this.commonPlugins,
      ],
    })

    vendor.js = buildOutput.outputFiles.find(x => x.path.endsWith('.js'))?.text || '';
    vendor.css = buildOutput.outputFiles.find(x => x.path.endsWith('.css'))?.text || '';

    this.prevVendorBundle = vendor;
    return vendor;
  }

  async compile() {
    await this.assertInitialized();
    log('Start compiling')

    this.npmRequired.length = 0;
    this.externalDeps.length = 0;

    const phase1output = await esbuild.build({
      entryPoints: ["/index.js"],
      bundle: true,
      write: false,
      outdir: "/user",
      format: "cjs",
      target: "es2022",
      platform: "browser",
      plugins: [
        ...this.userCodePlugins,
        ...this.commonPlugins,
      ],

      // yet not supported
      // splitting: true,
      // chunkNames: "chunk-[name]-[hash]",
    })

    let userJs = phase1output.outputFiles.find(x => x.path.endsWith('.js'))?.text || '';
    let userCss = phase1output.outputFiles.find(x => x.path.endsWith('.css'))?.text || '';
    log('user code compile done', phase1output);

    // phase 2: bundle vendor, including npm install
    // (may be skipped, if dep not changed)

    const vendorBundle = await this.bundleVendor()
    log('vendor bundle done', this.prevVendorBundle)

    // phase 3: bundle final
    const dlls = [vendorBundle]
    const finalJs = [
      `var require = (()=>{`,
      ` const deps = {}, require = name => {`,
      `   return deps[name];`,
      ` };`,
      ...dlls.map(dll => `Object.assign(deps, ${wrapCommonJS(dll.js)}.deps);`),
      ` return require;`,
      '})();',
      userJs,
    ].join('\n')
    const finalCss = [
      ...dlls.map(dll => dll.css),
      userCss,
    ].join('\n')

    log('phase3output', { js: finalJs, css: finalCss });

    return {
      js: finalJs,
      css: finalCss,
      npmRequired: this.npmRequired.slice(),
      externalDeps: this.externalDeps.slice(),
    }
  }
}

