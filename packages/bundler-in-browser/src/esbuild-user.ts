import type esbuild from "esbuild-wasm";
import { createESBuildNormalLoader, createESBuildResolver, EsbuildHelper, guessEntrypoint, type BaseBuildResult } from "./esbuild.js";
import { pathToNpmPackage, stripQuery } from "./utils/string.js";
import { isAbsolute, resolve } from "path";
import type { ImportKind } from "esbuild-wasm";

/**
 * usage:
 * 
 * 
 */

export class UserCodeEsbuildHelper extends EsbuildHelper<BuildUserCodeResult> {
  npmRequired: Set<string> = new Set();
  vendorDependents: Map<string, Set<string>> = new Map(); // { "lodash/debounce": ["/src/1.js", "/src/2.js"] }

  override makeEsbuildOptions() {
    const { bundler } = this;
    const { fs, esbuildBaseOptions, config } = bundler;

    const npmCollectPlugin = (): esbuild.Plugin => {
      return ({
        name: 'npm-collect',
        setup: (build) => {
          build.onResolve({ filter: /^[a-zA-Z].*|^@[\w-]+\/.*/ }, async (args) => {
            let fullPath = stripQuery(args.path);
            let [packageName] = pathToNpmPackage(fullPath);

            this.npmRequired.add(packageName);

            let arr = this.vendorDependents.get(fullPath);
            if (!arr) this.vendorDependents.set(fullPath, arr = new Set());
            arr.add(args.importer);

            return {
              path: fullPath,
              external: true
            };
          });
        }
      });
    };

    const opts: esbuild.BuildOptions = {
      ...esbuildBaseOptions,
      entryPoints: [config.entrypoint || guessEntrypoint(fs)],
      outdir: "/user",
      metafile: true,
      plugins: [
        this.getExternalPlugin(),
        ...bundler.userCodePlugins,
        npmCollectPlugin(),
        ...bundler.commonPlugins,
        createESBuildResolver(bundler),
        createESBuildNormalLoader(bundler),
      ],
    };

    return opts;
  }

  override beforeBuild() {
    super.baseBeforeBuild();
    this.npmRequired.clear();
    this.vendorDependents.clear();
  }

  override async build(): Promise<BuildUserCodeResult> {
    const baseResult = await super.baseBuild();
    const metafile = baseResult.esbuildOutput?.metafile
    const userFileMeta: Map<string, UserCodeFileMeta> = new Map();
    if (metafile?.inputs) {
      const toAbsPath = (rawPath: string) => {
        const prefixEnd = rawPath.indexOf(':') + 1;   // handle path with namespace, like sfc-template:src/index.vue
        const prefix = rawPath.slice(0, prefixEnd);
        let path = rawPath.slice(prefixEnd)
        if (!isAbsolute(path)) path = resolve('/', path)
        return prefix + path;
      }
      for (const [path, info] of Object.entries(metafile.inputs)) {
        userFileMeta.set(toAbsPath(path), {
          imports: (info.imports || []).map(it => ({
            ...it,
            path: it.external ? it.path : toAbsPath(it.path),
          })),
        });
      }
    }

    return {
      ...baseResult,
      npmRequired: Array.from(this.npmRequired),
      vendorDependents: new Map(Array.from(this.vendorDependents.entries(), ([k, v]) => [k, Array.from(v)])),
      externalsPaths: new Map(Array.from(this.externalsPaths.entries(), ([k, v]) => [k, Array.from(v)])),
      userFileMeta
    }
  }
}

export interface BuildUserCodeResult extends BaseBuildResult {
  /** npm packages required by user code */
  npmRequired: string[];

  /** 
   * imported vendor paths and their dependents (not including externals)
   * 
   * @see externalsPaths
   * @example
   *   { "lodash/debounce": ["/src/1.js", "/src/2.js"] }
   */
  vendorDependents: Map<string, string[]>;

  /**
   * imported external paths and their dependents
   * 
   * @see vendorDependents
   * @example
   *   { "some-lib": ["/src/1.js", "/src/2.js"] }
   */
  externalsPaths: Map<string, string[]>;

  /** 
   * user file's info (Eg. imports)
   * 
   * @remarks
   * this is almost identical to esbuild's `metafile.inputs`, so you might see `namespace:` in file paths:
   *  
   * ```yaml
   * {
   *   "/src/index.js": {
   *     imports: [
   *       { path: "vue", kind: "import-statement", external: true },
   *       { path: "/src/App.vue", kind: "import-statement", original: "./App.vue" },
   *     ]
   *   },
   *   "/src/App.vue": {
   *     imports: [
   *       { path: "sfc-template:/src/index.vue", kind: "import-statement", original: "/src/index.vue?template" },
   *     ]
   *   },
   *   "sfc-template:/src/index.vue": {
   *     imports: [
   *       { path: "vue", kind: "import-statement", external: true },
   *     ]
   *   },
   * }
   * ```
   */
  userFileMeta: Map<string, UserCodeFileMeta>;
}

export interface UserCodeFileMeta {
  imports: {
    /** the actual resolved path, like "/src/foobar.js" */
    path: string;
    kind: ImportKind;
    /** 
     * the original import path, like "./foobar". 
     * 
     * might be absent for some cases like `external`
     */
    original?: string;
    /** the import is external, or a vendor dependency */
    external?: boolean;
    with?: Record<string, string>;
  }[]
}
