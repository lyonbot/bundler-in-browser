import { Buffer } from "buffer";
import esbuild from "esbuild-wasm";
import { EventEmitter } from "./EventEmitter.js";
import { MiniNPM } from "./MiniNPM.js";
import { getDefaultBuildConfiguration, type BuildConfiguration } from "./configuration.js";
import { UserCodeEsbuildHelper } from "./esbuild-user.js";
import { VendorCodeEsbuildHelper, type VendorBundleConfig } from "./esbuild-vendor.js";
import { makeParallelTaskMgr } from "./parallelTask.js";
import { cloneDeep, separateNpmPackageNameVersion, stripQuery, toSortedArray, wrapCommonJS } from './utils.js';

export namespace BundlerInBrowser {
  export type BuildConfiguration = import('./configuration.js').BuildConfiguration;
  export type BuildUserCodeResult = import('./esbuild-user.js').BuildUserCodeResult;
  export type VendorBundleResult = import('./esbuild-vendor.js').VendorBundleResult;

  export interface ConcatCodeResult {
    /** entry content, in **UMD format**, containing user code and vendor code */
    js: string;

    /** entry css, containing vendor css + user css */
    css: string;

    /** all external dependencies, required by user code and vendor code */
    externals: string[];
  }

  export interface BuildResult extends ConcatCodeResult {
    /** 
     * npm packages required by user code, which will be installed by `npm install` before bundling.
     * 
     * this is a set of package names, without version.
     */
    npmRequired: string[];

    /**
     * the bundled user code without vendor.
     */
    userCode: BuildUserCodeResult;

    /** 
     * the used vendor bundle.
     * 
     * can be reloaded next time by `bundler.loadVendorBundle()`, to skip npm install & vendor bundling 
     */
    vendorBundle: VendorBundleResult;
  }

  export interface Events {
    'initialized': () => void;
    'build:start': () => void;
    'build:usercode': (result: BundlerInBrowser.BuildUserCodeResult) => void;
    'build:vendor': (result: BundlerInBrowser.VendorBundleResult) => void;
    'npm:progress': (event: MiniNPM.ProgressEvent) => void;
    'npm:packagejson:update': (newPackageJson: any) => void;
    'npm:install:done': () => void;
    'npm:install:error': (ev: { errors: Error[] }) => void;
  }

  /** 
   * a minimal fs for bundler-in-browser, must implement all these methods 
   * 
   * (signatures not strictly accurate - using versatile types to avoid weird TypeScript errors)
   */
  export interface IFs {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding?: 'utf-8' | string | any): string | Uint8Array;
    writeFileSync(path: string, data: string | Uint8Array): void;
    readdirSync(path: string): any[];
    mkdirSync(path: string, opts?: { recursive?: boolean }): any;
    symlinkSync(target: string, path: string): void;
    realpathSync(path: string, opts?: string | { encoding?: string }): any;
    unlinkSync(path: string): void;
    rmSync(path: string, opts?: { recursive?: boolean, force?: boolean }): void;

    readFile(path: string, cb: (err: any, data: any) => void): void;
    readFile(path: string, encoding: 'utf-8' | string | any, cb: (err: any, data: any) => void): void;
    stat(path: string, cb: (err: any, stats: any) => void): void;
    readlink(path: string, cb: (err: any, linkString: any) => void): void;
    readlink(path: string, options: any, cb: (err: any, linkString: any) => void): void;
  }
}

export class BundlerInBrowser {
  readonly fs: BundlerInBrowser.IFs;
  readonly events = new EventEmitter<BundlerInBrowser.Events>();

  readonly npm: MiniNPM;

  config: BuildConfiguration = getDefaultBuildConfiguration();

  /** 
   * ⚠️ please use `.config` to update configuration, not this. otherwise something may break.
   * 
   * @internal
   */
  esbuildBaseOptions: esbuild.BuildOptions = {
    bundle: true,
    format: "cjs",  // BundlerInBrowser will wrap code to UMD at the end.
    target: "es2022",
    platform: "browser",
    // no write
    // no minify
    // no entryPoints
    // no outdir
    // no plugins
  }

  initialized: Promise<void> | false = false;
  private async assertInitialized() {
    if (!this.initialized) throw new Error('BundlerInBrowser not initialized');
    await this.initialized;
  }

  static readonly esbuildVersion = esbuild.version;

  async initialize(opt: { esbuildWasmURL?: string | URL } = {}) {
    if (!this.initialized) {
      this.initialized = esbuild.initialize({
        wasmURL: opt.esbuildWasmURL || `https://cdn.jsdelivr.net/npm/esbuild-wasm@${esbuild.version}/esbuild.wasm`
        // wasmModule: await WebAssembly.compileStreaming(fetch('/node_modules/esbuild-wasm/esbuild.wasm'))
      });
    }
    await this.initialized;
  }

  userCodePlugins: esbuild.Plugin[] = [] // only for user code
  vendorPlugins: esbuild.Plugin[] = [] // only for vendor code
  commonPlugins: esbuild.Plugin[] = [] // works for both user and vendor, applied after userCodePlugins / vendorPlugins

  lastVendorBundle: undefined | BundlerInBrowser.VendorBundleResult

  constructor(fs: BundlerInBrowser.IFs) {
    this.fs = fs;

    this.npm = new MiniNPM(fs, { useJSDelivrToQueryVersions: false });
    this.npm.events.on('progress', event => {
      this.events.emit('npm:progress', event);
    });
  }

  async createUserCodeBuildHelper() {
    await this.assertInitialized();

    const buildHelper = new UserCodeEsbuildHelper(this);
    return buildHelper;
  }

  /** 
   * update `/package.json` and install missing npm packages.
   * 
   * to specify version, write like `foo@^1.2.3`
   * 
   * won't emit event.
   * 
   * @returns new package.json object
   */
  async addDepsToPackageJson(dependencies: string[]) {
    const { fs } = this;
    const path = '/package.json'
    const rootPackageJson = {
      name: 'root',
      version: '0.0.0',
      dependencies: {} as Record<string, string>,
    }

    // read package.json from fs
    try {
      if (fs.existsSync(path)) {
        const data = JSON.parse(fs.readFileSync(path, 'utf8') as string);
        Object.assign(rootPackageJson, data);
        if (!rootPackageJson.dependencies) rootPackageJson.dependencies = {};
      }
    } catch {
      // Silent fail, package.json is optional
    }

    // add missing npm dependencies
    const addingMissingDepTasks = makeParallelTaskMgr();
    for (const expr of dependencies) {
      addingMissingDepTasks.push(async () => {
        let [name, version] = separateNpmPackageNameVersion(expr, '')

        if (rootPackageJson.dependencies[name] && !version) return;
        if (!version) {
          const latest = await this.npm.getPackageVersions(name).then(v => v?.tags?.latest)
          if (!latest) throw new Error(`Cannot fetch version of ${name}`);
          version = `^${latest}`;
        }

        rootPackageJson.dependencies[name] = version;
      })
    }
    await addingMissingDepTasks.run()

    // write package.json
    fs.writeFileSync(path, JSON.stringify(rootPackageJson, null, 2));
    return rootPackageJson;
  }

  async createVendorBuildHelper(config: VendorBundleConfig) {
    await this.assertInitialized();

    const buildHelper = new VendorCodeEsbuildHelper(this, config);
    return buildHelper;
  }

  /**
   * generate a UMD format code, which contains user code and vendor code.
   */
  concatUserCodeAndVendors(
    userCode: BundlerInBrowser.BuildUserCodeResult,
    dlls: BundlerInBrowser.VendorBundleResult[],
  ): BundlerInBrowser.ConcatCodeResult {
    const { amdDefine, umdGlobalName, umdGlobalRequire } = this.config
    dlls = dlls.filter(Boolean);

    const externals = new Set(userCode.externals);
    dlls.forEach(dll => dll.externals.forEach(ex => externals.add(ex)));

    // generate amd define check code
    let amdDefineExists = '';  // typically is `typeof define === 'function' && define.amd`
    {
      let i = -1, first = true;
      while ((i = amdDefine.indexOf('.', i + 1)) !== -1) {
        if (first) { first = false; amdDefineExists += `typeof ${amdDefine.slice(0, i)} !== 'undefined' && `; }
        amdDefineExists += `!!(${amdDefine.slice(0, i)}) && `;
      }
      amdDefineExists += `typeof ${amdDefine} === 'function' && ${amdDefine}.amd`;
    }

    const finalJs = [
      `(function (root, factory) {`,
      `  if (${amdDefineExists}) {`, // AMD
      `    ${amdDefine}(${JSON.stringify(['require', ...externals])}, factory);`,
      `  } else if (typeof module === 'object' && module.exports) {`, // CommonJS
      `    module.exports = factory(typeof require === 'function' ? require : undefined);`,
      `  } else {`, // browser
      (umdGlobalName ? `  root[${JSON.stringify(umdGlobalName)}] = ` : '') +
      `    factory(${umdGlobalRequire || 'null'}\n);`,
      `  }`,
      `})(typeof self !== 'undefined' ? self : this, (outerRequire) => (`, // outerRequire
      `/* user code */`,
      `((require) => ${wrapCommonJS(userCode.js)})(`,
      `/* vendors */`,
      /* a wrapped require function, which will load vendor's deps */
      `(()=>{`,
      ` if (typeof outerRequire !== 'function') outerRequire = (s) => { throw new Error("require not implemented: " + s) };`, // ensure outerRequire is a function
      ` const $$deps={}, $$depsLoaded=Object.create(null),`, // deps =  { "foobar": () => module.exports }
      ` require = name => { `,
      `   if (!(name in $$deps)) return outerRequire(name);`, // unknown dep goes to outerRequire
      `   (name in $$depsLoaded) || ($$depsLoaded[name] = $$deps[name]());`,
      `   return $$depsLoaded[name];`,
      ` };`,
      ...dlls.map(dll => `Object.assign($$deps, ${wrapCommonJS(dll.js)}.deps);`),
      ` return require;`,
      '})())',
      '))',
    ].join('\n')

    const finalCss = [
      ...dlls.map(dll => dll.css),
      userCode.css,
    ].join('\n')

    return {
      js: finalJs,
      css: finalCss,
      externals: toSortedArray(externals),
    };
  }

  async build() {
    const { events, lastVendorBundle } = this;

    // assert initialized
    await this.assertInitialized();
    events.emit('build:start');

    // build user code
    const userCodeHelper = await this.createUserCodeBuildHelper();
    const userCode = await userCodeHelper.build();
    events.emit('build:usercode', userCode);

    // make vendorHelper for later use
    const vendorHelper = await this.createVendorBuildHelper({
      exportPaths: toSortedArray(userCode.vendorImportedPaths.keys()),
    });
    const isVendorReusable = lastVendorBundle?.hash === vendorHelper.hash;
    let vendorBundle: BundlerInBrowser.VendorBundleResult;

    // install npm packages and bundle vendor code
    // if vendor bundle is reusable, we can skip npm install and vendor bundling
    if (!isVendorReusable) {
      // update `/package.json` with user code npm dependencies
      const rootPackageJson = await this.addDepsToPackageJson(userCode.npmRequired);
      events.emit('npm:packagejson:update', rootPackageJson);

      // install npm packages
      if (!await this.npm.isAlreadySatisfied(rootPackageJson.dependencies)) {
        try {
          await this.npm.install(rootPackageJson.dependencies);
          this.events.emit('npm:install:done');
        } catch (err: any) {
          this.events.emit('npm:install:error', { errors: err.errors || [err] });
          throw err;
        }
      }

      // build vendor code
      vendorBundle = await vendorHelper.build();
      this.events.emit('build:vendor', vendorBundle);
      this.lastVendorBundle = vendorBundle;
    } else {
      // just reuse the last vendor bundle
      vendorBundle = lastVendorBundle!;
    }

    // compose build result
    const concatResult = this.concatUserCodeAndVendors(userCode, [vendorBundle])
    const result: BundlerInBrowser.BuildResult = {
      js: concatResult.js,
      css: concatResult.css,
      externals: concatResult.externals,

      npmRequired: toSortedArray(userCode.npmRequired),
      userCode,
      vendorBundle,
    }

    return result;
  }

  /**
   * load vendor bundle, which can be reloaded next time by `loadVendorBundle()`.
   */
  loadVendorBundle(bundle: BundlerInBrowser.VendorBundleResult | undefined | null) {
    if (!bundle) return;

    const b: BundlerInBrowser.VendorBundleResult = {
      hash: bundle.hash || '',
      js: bundle.js || '',
      css: bundle.css || '',
      externals: Array.from(bundle.externals || []),
      exportPaths: Array.from(bundle.exportPaths || []),
      esbuildOutput: undefined, // FIXME: do we really need this?
    }

    if (!b.css || !b.js || !b.hash) return; // invalid bundle
    this.lastVendorBundle = b;
  }

  /**
   * dump vendor bundle, which can be reloaded next time by `loadVendorBundle()`.
   */
  dumpVendorBundle() {
    return cloneDeep({
      ...this.lastVendorBundle,
      esbuildOutput: undefined, // don't dump esbuild output
    });
  }

  /** utils that plugin developers may use */
  pluginUtils = {
    /** remove `?` query from path. useful for onResolve plugins */
    stripQuery,

    /** for post processors - convert contents to string */
    contentsToString(contents: esbuild.OnLoadResult['contents']): string {
      if (typeof contents === 'string') return contents;
      if (contents instanceof Buffer) return contents.toString('utf8');
      else if (contents instanceof Uint8Array) return new TextDecoder().decode(contents);
      else throw new Error('unknown content type from fs. expected string/Buffer/Uint8Array');
    },

    /** if you have your own load plugin, use this to run post process like babel, postcss etc. */
    applyPostProcessors: async (args: esbuild.OnLoadArgs, result: esbuild.OnLoadResult) => {
      for (const processor of this.config.postProcessors) {
        const { test } = processor;
        if (typeof test === 'function' && !test(args)) continue;
        else if (test instanceof RegExp && !test.test(args.path)) continue;

        try {
          await processor.process(args, result);
        } catch (error) {
          result.errors ||= [];
          result.errors.push({
            text: `Error in postProcessor [${processor.name}]: ${error instanceof Error ? error.message : String(error)}`,
            location: {
              file: args.path,
              line: 1,
              column: 1,
            }
          });
          return result; // skip other processors
        }
      }

      return result;
    },
  }
}
