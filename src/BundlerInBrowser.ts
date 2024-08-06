import './dirty-stuff/monkey-patch.js';

import esbuild from "esbuild-wasm";
import { create as createResolver } from 'enhanced-resolve'
import { MiniNPM } from "./MiniNPM.js";
import { wrapCommonJS, pathToNpmPackage, makeParallelTaskMgr } from './utils.js';
import { log } from './log.js';

import type { IFs } from "memfs";

const setToSortedArray = (set: Set<string>) => Array.from(set).sort()

export namespace BundlerInBrowser {
  export interface VendorBundleResult {
    hash: string; // concat of sorted externalDeps

    externalDeps: string[];
    js: string;  // export `dep${index}`
    css: string;
  }

  export interface CompileUserCodeOptions {
    /** defaults to `/index.js` */
    entrypoint?: string

    /** eg. { "process.env.NODE_ENV": "production" } */
    define?: Record<string, string>;
  }
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

  public userCodePlugins: esbuild.Plugin[] = [] // only for user code
  public vendorPlugins: esbuild.Plugin[] = [] // only for vendor code
  public commonPlugins: esbuild.Plugin[] = [] // works for both user and vendor, will be appended to user plugins

  constructor(fs: IFs) {
    this.fs = fs;
    this.npm = new MiniNPM(fs, {
      useJSDelivrToQueryVersions: false,
    });

    this.npm.events.on('progress', event => {
      log('[npm]', event.stage, (event.dependentId || '') + ' > ', event.packageId, event.current + '/' + event.total);
    });

    const resolvePlugin = (): esbuild.Plugin => {
      const fs = this.fs;
      const resolve = createResolver({
        fileSystem: fs as any,
        extensions: ['.js', '.mjs', '.cjs', '.json', '.wasm', '.ts', '.tsx', '.jsx', '.vue'],
        conditionNames: ['import', 'require'],
        symlinks: true,
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
      // npmCollectPlugin will be installed at last, before common plugins
    )

    this.vendorPlugins.push(
    )

    this.commonPlugins.push(
      resolvePlugin(),
      commonLoaderPlugin(),
    )
  }

  npm: MiniNPM;

  /**
   * stage1: compile user code, collect npm dependencies, yields CommonJS module
   */
  async bundleUserCode(opts?: BundlerInBrowser.CompileUserCodeOptions) {
    await this.assertInitialized();

    const npmRequired = new Set<string>();
    const externalDeps = new Set<string>();

    const npmCollectPlugin = (): esbuild.Plugin => {
      return ({
        name: 'npm-collect',
        setup(build) {
          build.onResolve({ filter: /^[a-zA-Z].*|^@\w+\/.*/ }, async (args) => {
            let fullPath = args.path
            let [packageName] = pathToNpmPackage(fullPath)

            npmRequired.add(packageName);
            externalDeps.add(fullPath);

            return {
              path: fullPath,
              external: true
            }
          })
        }
      })
    }

    const output = await esbuild.build({
      entryPoints: [opts?.entrypoint || "/index.js"],
      bundle: true,
      write: false,
      outdir: "/user",
      format: "cjs",
      target: "es2022",
      platform: "browser",
      plugins: [
        ...this.userCodePlugins,
        npmCollectPlugin(), // after user plugins, before common plugins
        ...this.commonPlugins,
      ],

      // yet not supported
      // splitting: true,
      // chunkNames: "chunk-[name]-[hash]",
    })

    let userJs = output.outputFiles.find(x => x.path.endsWith('.js'))?.text || '';
    let userCss = output.outputFiles.find(x => x.path.endsWith('.css'))?.text || '';

    return {
      js: userJs,
      css: userCss,
      npmRequired,
      externalDeps,
      esbuildOutput: output,
    }
  }

  /**
   * stage2: bundle vendor, including npm install
   * 
   * if `/package.json` exists, it will be used to specify dependencies version.
   * new dependencies will be added to package.json, and will be installed too.
   */
  async bundleVendor(opts: {
    hash: string;
    npmRequired: Set<string>;
    externalDeps: Set<string>;

    define?: Record<string, string>;
  }) {
    await this.assertInitialized();

    const externalDeps = Array.from(opts.externalDeps)
    const rootPackageJson = {
      name: 'root',
      version: '0.0.0',
      dependencies: {} as Record<string, string>,
    }

    // read package.json from fs
    try {
      const path = '/package.json'
      if (this.fs.existsSync(path)) {
        const data = await this.fs.promises.readFile(path, 'utf8').then(data => JSON.parse(data as string));
        Object.assign(rootPackageJson, data);
        if (!rootPackageJson.dependencies) rootPackageJson.dependencies = {};
      }
    } catch (err) {
      log('read package.json failed. fallback to empty object', err);
    }

    // add missing npm dependencies
    const addingMissingDepTasks = makeParallelTaskMgr();
    for (const name of opts.npmRequired) {
      addingMissingDepTasks.push(async () => {
        if (rootPackageJson.dependencies[name]) return;

        const version = await this.npm.getPackageVersions(name).then(v => v?.tags?.latest)
        if (!version) throw new Error(`Cannot fetch version of ${name}`);

        rootPackageJson.dependencies[name] = `^${version}`;
      })
    }
    await addingMissingDepTasks.run()

    // write package.json
    await this.fs.promises.writeFile('/package.json', JSON.stringify(rootPackageJson, null, 2));
    log('write package.json done', rootPackageJson);

    // wait for all npm installs to finish
    await this.npm.install(rootPackageJson.dependencies);
    log('npm install done');

    // create a new bundle
    const vendor: BundlerInBrowser.VendorBundleResult = {
      hash: opts.hash,
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
      entryContent += `"${dep}": () => require("${dep}"),\n`
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
      minify: true,
      define: { ...opts.define },
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

    return vendor;
  }

  concatUserCodeAndVendors(
    userCode: { css: string, js: string },
    dlls: BundlerInBrowser.VendorBundleResult[],
  ) {
    const finalJs = [
      `var require = (()=>{`,
      ` const $$deps={}, $$depsLoaded=Object.create(null),`, // deps =  { "foobar": () => module.exports }
      ` require = name => { (name in $$depsLoaded) || ($$depsLoaded[name] = $$deps[name]()); return $$depsLoaded[name]; };`,
      ...dlls.map(dll => `Object.assign($$deps, ${wrapCommonJS(dll.js)}.deps);`),
      ` return require;`,
      '})();',
      userCode.js,
    ].join('\n')

    const finalCss = [
      ...dlls.map(dll => dll.css),
      userCode.css,
    ].join('\n')

    return { js: finalJs, css: finalCss }
  }

  /** cached result of `bundleVendor()`, only for `compile()` */
  lastVendorBundle: undefined | BundlerInBrowser.VendorBundleResult

  async compile(opts?: BundlerInBrowser.CompileUserCodeOptions) {
    await this.assertInitialized();
    log('Start compiling')

    // stage 1: compile user code, collect npm dependencies, yields CommonJS module

    const userCode = await this.bundleUserCode(opts);
    log('user code compile done', userCode);

    // phase 2: bundle vendor, including npm install
    // (may be skipped, if dep not changed)

    const sortedDefine = Object.entries(opts?.define || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(';');
    const vendorHash = `${setToSortedArray(userCode.externalDeps).join(',')}/${sortedDefine}`;
    const canReuseVendorBundle = (() => {
      const prev = this.lastVendorBundle?.externalDeps;
      if (!prev) return false;

      const prevSet = new Set(prev);
      return Array.from(userCode.externalDeps).every(dep => prevSet.has(dep));
    })();
    const vendorBundle = canReuseVendorBundle
      ? this.lastVendorBundle!
      : (this.lastVendorBundle = await this.bundleVendor({
        hash: vendorHash,
        npmRequired: userCode.npmRequired,
        externalDeps: userCode.externalDeps,
        define: opts?.define,
      }))

    log('vendor bundle done', vendorBundle)

    // phase 3: concat all into one file

    const final = this.concatUserCodeAndVendors(userCode, [vendorBundle])
    log('phase3output', final);

    return {
      js: final.js,
      css: final.css,
      vendorBundle,
      npmRequired: Array.from(userCode.npmRequired),
      externalDeps: Array.from(userCode.externalDeps),
    }
  }
}

