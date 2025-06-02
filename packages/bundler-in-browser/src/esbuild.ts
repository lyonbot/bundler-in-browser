import esbuild from "esbuild-wasm";
import { dirname } from "path";
import { create as createResolver } from 'enhanced-resolve'
import type { BundlerInBrowser } from "./BundlerInBrowser.js";
import type { BuildConfiguration } from "./configuration.js";
import { escapeRegExp, stripQuery } from "./utils.js";

/* esbuild builtin loaders */
const builtinLoaders = ['js', 'jsx', 'tsx', 'ts', 'css', 'json', 'text'] satisfies esbuild.Loader[]

export abstract class EsbuildHelper<TResult> {
  /** the context of helper */
  bundler: BundlerInBrowser;

  constructor(bundler: BundlerInBrowser) {
    this.bundler = bundler;
  }

  /** all  */
  externalsPaths: Map<string, string[]> = new Map(); // { "lodash/debounce": ["/src/1.js", "/src/2.js"] }
  protected getExternalPlugin() {
    return createESBuildExternalsCollector(this.bundler.config.externals, (imported, importer) => {
      let arr = this.externalsPaths.get(imported);
      if (!arr) this.externalsPaths.set(imported, arr = []);
      arr.push(importer);
    });
  }

  protected baseBeforeBuild() {
    this.externalsPaths.clear();
  }

  protected async baseBuild(): Promise<BaseBuildResult> {
    this.beforeBuild();
    const options = this.makeEsbuildOptions();
    const output = await esbuild.build({
      ...options,
      write: false,
    });

    let js = output.outputFiles.find(x => x.path.endsWith('.js'))?.text || '';
    let css = output.outputFiles.find(x => x.path.endsWith('.css'))?.text || '';

    return {
      js,
      css,
      externals: Array.from(this.externalsPaths.keys()),
      esbuildOutput: output,
    };
  }

  abstract makeEsbuildOptions(): esbuild.BuildOptions;
  abstract beforeBuild(): void;
  abstract build(): Promise<TResult>;
}

export interface BaseBuildResult {
  /** the javascript content. in commonjs format */
  js: string;

  /** the css content. */
  css: string;

  /** imported external paths and assets */
  externals: string[];

  /** original esbuild result */
  esbuildOutput?: esbuild.BuildResult;
}

// ----------------------------------------------

export function guessEntrypoint(fs: BundlerInBrowser.IFs) {
  const suffix = ['.js', '.ts', '.jsx', '.tsx']
  const prefix = ['/', '/src/'];

  for (const p of prefix) {
    for (const s of suffix) {
      const path = p + 'index' + s;
      if (fs.existsSync(path)) return path;
    }
  }

  throw new Error(`Cannot find entry point, please specify one in options.entrypoint`);
}

export function createESBuildNormalLoader(bundler: BundlerInBrowser): esbuild.Plugin {
  const { fs } = bundler;

  return ({
    name: "normal-loader",
    setup(build) {
      build.onLoad({ filter: /\.([mc]?jsx?|tsx?|css|json|txt)$/ }, async (args) => {
        let fullPath = args.path;
        let suffix = fullPath.split('.').pop()!;
        let loader: esbuild.Loader = 'js';

        if (builtinLoaders.includes(suffix as any)) loader = suffix as typeof builtinLoaders[number];
        else if (suffix === 'txt') loader = 'text';
        else if (suffix === 'cjs' || suffix === 'mjs') loader = 'js';

        // support for css modules
        if (loader === 'css' && /\.module\.\w+$/.test(fullPath)) loader = 'local-css';
        const result: esbuild.OnLoadResult = {
          contents: fs.readFileSync(fullPath),
          loader,
        }

        // support for preprocessors
        return await bundler.pluginUtils.applyPostProcessors(args, result);
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

export function createESBuildResolver(bundler: BundlerInBrowser): esbuild.Plugin {
  const { fs, config: { extensions } } = bundler;

  const resolve = createResolver({
    fileSystem: fs as any,
    extensions: extensions.slice(),
    mainFields: ['module', 'browser', 'main'],
    conditionNames: ['import', 'require'],
    symlinks: true,
  })

  return ({
    name: "resolve",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        let fullPath = stripQuery(args.path);
        let suffix = args.path.slice(fullPath.length);
        if (/^(https?:)\/\/|^data:/.test(fullPath)) return { external: true, path: fullPath, suffix }; // URL is external

        return await new Promise((done, reject) => {
          resolve(args.resolveDir || dirname(args.importer), fullPath, (err, res) => {
            if (err) return reject(err);
            if (!res) return reject(new Error(`Cannot resolve ${fullPath}`));

            else done({ path: res, suffix });
          })
        });
      });
    },
  });
}

export function createESBuildExternalsCollector(
  externals: BuildConfiguration['externals'],
  onCollected: (imported: string, importer: string) => void
) {
  const regexParts: { [flags: string]: string[] } = {};
  for (const e of externals || []) {
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
    .map(([flags, sources]) => new RegExp(`(?:${sources.join(')|(?:')})`, flags))

  const plugin: esbuild.Plugin = {
    name: 'externals-collector',
    setup(build) {
      if (!allRegex.length) return;

      build.onResolve({ filter: /.*/ }, async (args) => {
        if (allRegex.some(regex => regex.test(args.path))) {
          onCollected(args.path, args.importer);
          return { path: args.path, external: true }
        }
      })
    },
  }

  return plugin
}
