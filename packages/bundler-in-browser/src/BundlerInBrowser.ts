import esbuild from "esbuild-wasm";
import { create as createResolver } from 'enhanced-resolve'
import { MiniNPM } from "./MiniNPM.js";
import { wrapCommonJS, pathToNpmPackage, makeParallelTaskMgr, escapeRegExp, cloneDeep } from './utils.js';
import { EventEmitter } from "./EventEmitter.js";
import { dirname } from "path";
import { processCSS } from "./plugins/common.js";

const setToSortedArray = (set: Set<string>) => Array.from(set).sort()

export namespace BundlerInBrowser {
  export interface VendorBundleResult {
    hash: string; // concat of sorted exposedDeps

    exports: string[];
    external: string[];
    js: string;  // export `dep${index}`
    css: string;
  }

  export interface BuildUserCodeOptions {
    /** defaults to `/index.js` */
    entrypoint?: string;

    minify?: boolean;

    /** eg. { "process.env.NODE_ENV": "production" } */
    define?: Record<string, string>;

    /** 
     * exclude dependencies from bundle.
     * 
     * - string `"@foo/bar"` also matches `@foo/bar/baz.js`
     * - string supports wildcards like `"*.png"`
     * - regexp `/^vue$/` will NOT match `vue/dist/vue.esm-bundler.js`
     * 
     */
    external?: (string | RegExp)[];

    /** 
     * your custom `define` function name. defaults to `"define"` 
     * 
     * Note: the function must have `amd` flag ( will check `define.amd == true` )
     */
    amdDefine?: string;

    /** 
     * in UMD mode, module will expose at `self[umdGlobalName]` (usually self is `window`) 
     */
    umdGlobalName?: string;

    /** 
     * in UMD mode, your mock *require(id)* function. set to null to disable.
     * 
     * this shall be a expression like `"window.myRequire"`, pointing to a function, which looks like `(id) => { return ... }`
     * 
     * @note you won't need this if `external` not set.
     */
    umdGlobalRequire?: string;

    /**
     * optional. applies to every css / sass / scss file.
     */
    postcssProcessor?: typeof import('postcss').Processor
  }

  export interface BuildUserCodeResult {
    /** entry js file content, in CommonJS format */
    js: string;

    /** entry css file content */
    css: string;

    /** all npm package id, required by user code. eg `["vue", "lodash"]` */
    npmRequired: Set<string>;

    /** full vendor paths imported by user code, eg `["vue", "lodash/debounce"]` */
    vendorExports: Set<string>;

    /** all actual-used dependencies that declared in `external` (the build options) */
    external: Set<string>;

    /** raw esbuild output */
    esbuildOutput: esbuild.BuildResult;
  }

  export interface ConcatCodeResult {
    /** entry content, in **UMD format**, containing user code and vendor code */
    js: string;

    /** entry css, containing vendor css + user css */
    css: string;

    /** all external dependencies, required by user code and vendor code */
    external: Set<string>;
  }

  export type BuildResult
    = ConcatCodeResult
    & Pick<BuildUserCodeResult, 'npmRequired' | 'vendorExports'>
    & {
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
    'build:usercode': (result: { npmRequired: Set<string>, vendorExports: Set<string>, external: Set<string> }) => void;
    'build:vendor': (result: BundlerInBrowser.VendorBundleResult) => void;
    'npm:progress': (event: MiniNPM.ProgressEvent) => void;
    'npm:packagejson:update': (newPackageJson: any) => void;
    'npm:install:done': () => void;
    'npm:install:error': (ev: { errors: Error[] }) => void;
  }

  export interface IFs {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding?: 'utf-8' | string | any): string | Uint8Array;
    writeFileSync(path: string, data: string | Uint8Array): void;
    readdirSync(path: string): string[];
    mkdirSync(path: string, opts?: { recursive?: boolean }): any;
    symlinkSync(target: string, path: string): void;
    realpathSync(path: string, opts?: string | { encoding?: string }): any;
    unlinkSync(path: string): void;
    rmSync(path: string, opts?: { recursive?: boolean, force?: boolean }): void;
  }
}

export class BundlerInBrowser {
  public readonly fs: BundlerInBrowser.IFs;

  public events = new EventEmitter<BundlerInBrowser.Events>();

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

  public userCodePlugins: (esbuild.Plugin | ((opts: BundlerInBrowser.BuildUserCodeOptions) => (esbuild.Plugin | null)))[] = [] // only for user code
  public vendorPlugins: esbuild.Plugin[] = [] // only for vendor code
  public commonPlugins: esbuild.Plugin[] = [] // works for both user and vendor, will be appended to user plugins

  constructor(fs: BundlerInBrowser.IFs) {
    this.fs = fs;
    this.npm = new MiniNPM(fs, {
      useJSDelivrToQueryVersions: false,
    });

    this.npm.events.on('progress', event => {
      this.events.emit('npm:progress', event);
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
              resolve(args.resolveDir || dirname(args.importer), fullPath, (err, res) => {
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

            if (loader === 'css') {
              return await processCSS(build, fullPath, fs.readFileSync(fullPath, 'utf8') as string)
            }

            return {
              contents: fs.readFileSync(fullPath),
              loader
            }
          })

          build.onLoad({ filter: /\.(png|jpe?g|gif|svg|webp)$/ }, async (args) => {
            return {
              contents: fs.readFileSync(args.path),
              loader: 'dataurl'
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
   * stage1: build user code, collect npm dependencies, yields CommonJS module
   */
  async bundleUserCode(opts: BundlerInBrowser.BuildUserCodeOptions): Promise<BundlerInBrowser.BuildUserCodeResult> {
    await this.assertInitialized();

    const npmRequired = new Set<string>();
    const vendorExports = new Set<string>();
    const externalCollect = getExternalPlugin(opts.external);

    const npmCollectPlugin = (): esbuild.Plugin => {
      return ({
        name: 'npm-collect',
        setup(build) {
          build.onResolve({ filter: /^[a-zA-Z].*|^@\w+\/.*/ }, async (args) => {
            let fullPath = args.path
            let [packageName] = pathToNpmPackage(fullPath)

            npmRequired.add(packageName);
            vendorExports.add(fullPath);

            return {
              path: fullPath,
              external: true
            }
          })
        }
      })
    }

    const userCodePlugins: esbuild.Plugin[] = []
    for (let plugin of this.userCodePlugins) {
      const p = typeof plugin === 'function' ? plugin(opts) : plugin;
      if (p) userCodePlugins.push(p);
    }

    let entryPath = opts.entrypoint;
    if (!entryPath) {
      const candidates = [
        '/index.js', '/index.ts', '/index.jsx', '/index.tsx',
        '/src/index.js', '/src/index.ts', '/src/index.jsx', '/src/index.tsx',
      ];
      for (let path of candidates) {
        if (this.fs.existsSync(path)) { entryPath = path; break }
      }
      if (!entryPath) throw new Error(`Cannot find entry point, please specify one in options.entrypoint`);
    }

    const output = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      outdir: "/user",
      format: "cjs",
      target: "es2022",
      platform: "browser",
      minify: !!opts.minify,
      plugins: [
        externalCollect.plugin,
        ...userCodePlugins,
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
      vendorExports,
      external: externalCollect.collected,
      esbuildOutput: output,
    }
  }

  /**
   * stage2: npm install & bundle vendor
   * 
   * - all new dependencies will be installed and add to `/package.json`
   * - if `/package.json` exists, it will be used to specify dependencies version. ( the `npmRequired` doesn't include version number )
   */
  async bundleVendor(opts: {
    hash: string;
    npmRequired: Set<string>;
    exports: Set<string>;

    external?: (string | RegExp)[];
    define?: Record<string, string>;
  }): Promise<BundlerInBrowser.VendorBundleResult> {
    await this.assertInitialized();

    const exposedDeps = Array.from(opts.exports)
    const externalCollect = getExternalPlugin(opts.external);

    const rootPackageJson = {
      name: 'root',
      version: '0.0.0',
      dependencies: {} as Record<string, string>,
    }

    // read package.json from fs
    try {
      const path = '/package.json'
      if (this.fs.existsSync(path)) {
        const data = JSON.parse(this.fs.readFileSync(path, 'utf8') as string);
        Object.assign(rootPackageJson, data);
        if (!rootPackageJson.dependencies) rootPackageJson.dependencies = {};
      }
    } catch (err) {
      // Silent fail, package.json is optional
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
    this.events.emit('npm:packagejson:update', rootPackageJson);
    this.fs.writeFileSync('/package.json', JSON.stringify(rootPackageJson, null, 2));

    try {
      await this.npm.install(rootPackageJson.dependencies);
      this.events.emit('npm:install:done');
    } catch (err: any) {
      this.events.emit('npm:install:error', { errors: err.errors || [err] });
      throw err;
    }

    // create a new bundle
    const vendor: BundlerInBrowser.VendorBundleResult = {
      hash: opts.hash,
      exports: exposedDeps,
      external: [],
      js: '',
      css: '',
    }

    const workDir = `/vendor_dll`

    let entryPath = `${workDir}/source.js`
    let entryPathRegex = new RegExp(`^${entryPath}$`)
    let entryContent = 'exports.deps = {\n'

    for (let i = 0; i < exposedDeps.length; i++) {
      const dep = exposedDeps[i];
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
        externalCollect.plugin,
        ...this.vendorPlugins,
        ...this.commonPlugins,
      ],
    })

    vendor.js = buildOutput.outputFiles.find(x => x.path.endsWith('.js'))?.text || '';
    vendor.css = buildOutput.outputFiles.find(x => x.path.endsWith('.css'))?.text || '';
    vendor.external = Array.from(externalCollect.collected);

    return vendor;
  }

  /**
   * stage3: concat user code and vendor code
   * 
   * in the output, `js` is in UMD format, and `external` is dependencies excluded from the bundle.
   */
  concatUserCodeAndVendors(
    userCode: { css: string, js: string; external: Set<string> },
    dlls: BundlerInBrowser.VendorBundleResult[],
    opts: Pick<BundlerInBrowser.BuildUserCodeOptions,
      'amdDefine' | 'umdGlobalName' | 'umdGlobalRequire'> = {},
  ): BundlerInBrowser.ConcatCodeResult {
    const external = new Set(([...userCode.external]).concat(...dlls.map(dll => dll.external)));

    const amdDefine = opts.amdDefine || 'define';
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
      `    ${amdDefine}(${JSON.stringify(['require', ...external])}, factory);`,
      `  } else if (typeof module === 'object' && module.exports) {`, // CommonJS
      `    module.exports = factory(typeof require === 'function' ? require : undefined);`,
      `  } else {`, // browser
      (opts.umdGlobalName ? `  root[${JSON.stringify(opts.umdGlobalName)}] = ` : '') +
      `    factory(${opts.umdGlobalRequire || '() => { throw new Error("require not implemented") }'}\n);`,
      `  }`,
      `})(typeof self !== 'undefined' ? self : this, (require) => (`, // outerRequire
      `((require) => ${wrapCommonJS(userCode.js)})(`,
      /* a wrapped require function, which will load vendor's deps */
      `((outerRequire)=>{`,
      ` const $$deps={}, $$depsLoaded=Object.create(null),`, // deps =  { "foobar": () => module.exports }
      ` require = name => { `,
      `   if (!(name in $$deps)) return outerRequire(name);`, // unknown dep goes to outerRequire
      `   (name in $$depsLoaded) || ($$depsLoaded[name] = $$deps[name]());`,
      `   return $$depsLoaded[name];`,
      ` };`,
      ...dlls.map(dll => `Object.assign($$deps, ${wrapCommonJS(dll.js)}.deps);`),
      ` return require;`,
      '})(require))',
      '))',
    ].join('\n')

    const finalCss = [
      ...dlls.map(dll => dll.css),
      userCode.css,
    ].join('\n')


    return { js: finalJs, css: finalCss, external }
  }

  /** cached result of `bundleVendor()`, only for `build()` */
  lastVendorBundle: undefined | BundlerInBrowser.VendorBundleResult

  loadVendorBundle(bundle: BundlerInBrowser.VendorBundleResult | undefined | null) {
    if (!bundle) return;

    const b = {} as BundlerInBrowser.VendorBundleResult;
    b.css = bundle.css || '';
    b.js = bundle.js || '';
    b.external = Array.from(bundle.external || []);
    b.exports = Array.from(bundle.exports || []);
    b.hash = bundle.hash || '';

    if (!b.css || !b.js || !b.hash) return; // invalid bundle
    this.lastVendorBundle = b;
  }

  dumpVendorBundle() {
    return cloneDeep(this.lastVendorBundle);
  }

  /**
   * build and compile user code, install npm dependencies, and bundle to UMD format.
   * 
   * in the output, `js` is in UMD format, and `external` is dependencies excluded from the bundle.
   */
  async build(opts?: BundlerInBrowser.BuildUserCodeOptions): Promise<BundlerInBrowser.BuildResult> {
    await this.assertInitialized();
    this.events.emit('build:start');

    // stage 1: build user code, collect npm dependencies, yields CommonJS module

    const userCode = await this.bundleUserCode(opts || {});
    this.events.emit('build:usercode', {
      npmRequired: userCode.npmRequired,
      vendorExports: userCode.vendorExports,
      external: userCode.external
    });

    // phase 2: bundle vendor, including npm install
    // (may be skipped, if dep not changed)

    const vendorHash = [
      /* vendor's import */ opts?.external?.join('|'),
      /* vendor's exports */ setToSortedArray(userCode.vendorExports).join(','),
      /* define */ Object.entries(opts?.define || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(';'),
    ].join('\n');

    const canReuseVendorBundle = (() => {
      const prev = this.lastVendorBundle?.exports;
      if (!prev) return false;

      const prevSet = new Set(prev);
      return Array.from(userCode.vendorExports).every(dep => prevSet.has(dep));
    })();
    const vendorBundle = canReuseVendorBundle
      ? this.lastVendorBundle!
      : (this.lastVendorBundle = await this.bundleVendor({
        hash: vendorHash,
        npmRequired: userCode.npmRequired,
        exports: userCode.vendorExports,
        define: opts?.define,
      }))

    this.events.emit('build:vendor', vendorBundle);

    // phase 3: concat all into one file

    const final = this.concatUserCodeAndVendors(userCode, [vendorBundle], opts)

    const external = new Set(final.external);
    vendorBundle.external.forEach(ex => external.add(ex));

    return {
      // from ConcatCodeResult
      js: final.js,
      css: final.css,
      external,
      // from userCode
      npmRequired: new Set(userCode.npmRequired),
      vendorExports: new Set(userCode.vendorExports),
      // from vendorBundle
      vendorBundle,
    }
  }
}

/** alias of `BundlerInBrowser.Events` */
export type BundlerInBrowserEvents = BundlerInBrowser.Events;

function getExternalPlugin(external?: (string | RegExp)[]) {
  const regexParts: { [flags: string]: string[] } = {};
  for (const e of external || []) {
    if (!e) continue;

    let flags = '', source = '';
    if (e instanceof RegExp) {
      flags = e.flags;
      source = e.source;
    } else {
      source = '^' + escapeRegExp(e).replace(/\\\*/g, '.*');
    }

    if (!regexParts[flags]) regexParts[flags] = [];
    regexParts[flags].push(source);
  }

  const allRegex = Object
    .entries(regexParts)
    .map(([flags, sources]) => new RegExp(`(${sources.join(')|(')})`, flags))

  const collected = new Set<string>();
  const plugin: esbuild.Plugin = {
    name: 'external',
    setup(build) {
      if (!allRegex.length) return;

      build.onResolve({ filter: /.*/ }, async (args) => {
        if (allRegex.some(regex => regex.test(args.path))) {
          collected.add(args.path);
          return { path: args.path, external: true }
        }
      })
    },
  }

  return { collected, plugin }
}
