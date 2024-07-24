import './dirty-stuff/monkey-patch.js';

import esbuild from "esbuild-wasm";
import esbuildWasm from "esbuild-wasm/esbuild.wasm?url";
import { create as createResolver, type ResolveContext } from 'enhanced-resolve'
import { type IFs } from "memfs";
import { MiniNPM } from "./npm.js";
import { decodeUTF8, log } from './utils.js';
import path from 'path';

let initPromise: Promise<void> | undefined;

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
    const sassLoaderPlugin = (): esbuild.Plugin => {
      return ({
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
      sassLoaderPlugin(),
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
    const externalDeps = Array.from(this.externalDeps)
    const hash = externalDeps.sort().join(',')

    if (this.prevVendorBundle?.hash === hash) return this.prevVendorBundle;
    await Promise.all(this.npmRequired.map(p => this.npm.install(p)));

    const vendor: VendorBundleResult = {
      hash,
      externalDeps,
      js: '',
      css: '',
    }

    const fs = this.fs;
    const workDir = `/@@vendor`
    fs.mkdirSync(workDir, { recursive: true });

    let entryFilePath = `${workDir}/index.js`
    let entrySourceFilePath = `${workDir}/source.js`
    let entryJs = 'exports.deps = {\n'

    for (let i = 0; i < externalDeps.length; i++) {
      const dep = externalDeps[i];
      entryJs += `"${dep}": require("${dep}"),\n`
    }
    entryJs += '};'
    fs.writeFileSync(entrySourceFilePath, entryJs);

    const buildOutput = await esbuild.build({
      entryPoints: [entrySourceFilePath],
      bundle: true,
      write: false,
      format: "cjs",
      target: "es2022",
      platform: "browser",
      plugins: [
        ...this.vendorPlugins,
        ...this.commonPlugins,
      ],
    })

    vendor.js = buildOutput.outputFiles[0].text;
    this.prevVendorBundle = vendor;
    return vendor;
  }

  async compile() {
    await this.initialize();
    const fs = this.fs;

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

    log('Compile done');
    fs.mkdirSync('/user', { recursive: true });
    phase1output.outputFiles.forEach(f => {
      fs.writeFileSync(f.path, f.contents)
    })

    // phase 2: bundle vendor, including npm install
    // (may be skipped, if dep not changed)

    const vendorBundle = await this.bundleVendor()
    log('vendor bundle done', this.prevVendorBundle)

    // phase 3: bundle final
    let phase3Code = [
      `var require = (()=>{`,
      ` var module = {exports:{}},exports=module.exports,require=null;`,
      vendorBundle.js,
      ' return (deps => name => {',
      '   return deps[name];',
      ' })(module.exports.deps)',
      '})();',
      '',
      phase1output.outputFiles[0].text,
    ].join('\n')
    log('phase3output', { phase3Code });

    return phase3Code
  }
}

