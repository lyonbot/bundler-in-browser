import esbuild from "esbuild-wasm";
import { create as createResolver } from 'enhanced-resolve'
import { MiniNPM } from "./MiniNPM.js";
import { wrapCommonJS, pathToNpmPackage, makeParallelTaskMgr, escapeRegExp, cloneDeep } from './utils.js';
import { log } from './log.js';

import type { IFs } from "memfs";

const setToSortedArray = (set: Set<string>) => Array.from(set).sort()

export namespace BundlerInBrowser {
  export interface VendorBundleResult {
    hash: string; // concat of sorted exposedDeps

    exports: string[];
    external: string[];
    js: string;  // export `dep${index}`
    css: string;
  }

  export interface CompileUserCodeOptions {
    /** defaults to `/index.js` */
    entrypoint?: string

    minify?: boolean;

    /** eg. { "process.env.NODE_ENV": "production" } */
    define?: Record<string, string>;

    /** 
     * all these deps will NOT be bundled.
     * 
     * - `"@foo/bar"` contains `@foo/bar/baz.js`
     * - you can use wildcards like `"*.png"`
     * - `/^vue$/` will NOT match `/vue/dist/vue.esm-bundler.js`
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
  }
}

export class BundlerInBrowser {
  public readonly fs: IFs;

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
    const vendorExports = new Set<string>();
    const externalCollect = getExternalPlugin(opts?.external);

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

    const output = await esbuild.build({
      entryPoints: [opts?.entrypoint || "/index.js"],
      bundle: true,
      write: false,
      outdir: "/user",
      format: "cjs",
      target: "es2022",
      platform: "browser",
      minify: !!opts?.minify,
      plugins: [
        externalCollect.plugin,
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
      vendorExports,
      external: externalCollect.collected,
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
    exports: Set<string>;

    external?: (string | RegExp)[];
    define?: Record<string, string>;
  }) {
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

  concatUserCodeAndVendors(
    userCode: { css: string, js: string; external: Set<string> },
    dlls: BundlerInBrowser.VendorBundleResult[],
    opts: Pick<BundlerInBrowser.CompileUserCodeOptions,
      'amdDefine' | 'umdGlobalName' | 'umdGlobalRequire'> = {},
  ) {
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

  /** cached result of `bundleVendor()`, only for `compile()` */
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

  async compile(opts?: BundlerInBrowser.CompileUserCodeOptions) {
    await this.assertInitialized();
    log('Start compiling')

    // stage 1: compile user code, collect npm dependencies, yields CommonJS module

    const userCode = await this.bundleUserCode(opts);
    log('user code compile done', userCode);

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

    log('vendor bundle done', vendorBundle)

    // phase 3: concat all into one file

    const final = this.concatUserCodeAndVendors(userCode, [vendorBundle], opts)
    log('phase3output', final);

    return {
      js: final.js,
      css: final.css,
      vendorBundle,
      npmRequired: Array.from(userCode.npmRequired),
      external: Array.from(userCode.external),
      vendorExports: Array.from(userCode.vendorExports),
    }
  }
}

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
