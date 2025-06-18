import type esbuild from "esbuild-wasm";
import { createESBuildNormalLoader, createESBuildResolver, EsbuildHelper, guessEntrypoint, type BaseBuildResult } from "./esbuild.js";
import { pathToNpmPackage, stripQuery } from "./utils/string.js";

/**
 * usage:
 * 
 * 
 */

export class UserCodeEsbuildHelper extends EsbuildHelper<BuildUserCodeResult> {
  npmRequired: Set<string> = new Set();
  vendorImportedPaths: Map<string, string[]> = new Map(); // { "lodash/debounce": ["/src/1.js", "/src/2.js"] }
  userFileDependents: Map<string, string[]> = new Map(); // { "/src/utils.js": ["/src/1.js", "/src/2.js"] }

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

            let arr = this.vendorImportedPaths.get(fullPath);
            if (!arr) this.vendorImportedPaths.set(fullPath, arr = []);
            arr.push(args.importer);

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
      sourcemap: 'linked',
      sourceRoot: '/',
      entryPoints: [config.entrypoint || guessEntrypoint(fs)],
      outdir: "/user",
      plugins: [
        this.getExternalPlugin(),
        ...bundler.userCodePlugins,
        npmCollectPlugin(),
        ...bundler.commonPlugins,
        createESBuildResolver(bundler, {
          onResolved: (args, target) => {
            let arr = this.userFileDependents.get(target);
            if (!arr) this.userFileDependents.set(target, arr = []);
            arr.push(args.importer);
          }
        }),
        createESBuildNormalLoader(bundler),
      ],
    };

    return opts;
  }

  override beforeBuild() {
    super.baseBeforeBuild();
    this.npmRequired.clear();
    this.vendorImportedPaths.clear();
    this.userFileDependents.clear();
  }

  override async build(): Promise<BuildUserCodeResult> {
    const baseResult = await super.baseBuild();
    return {
      ...baseResult,
      npmRequired: Array.from(this.npmRequired),
      vendorImportedPaths: new Map(this.vendorImportedPaths),
      userFileDependents: new Map(this.userFileDependents),
    }
  }
}

export interface BuildUserCodeResult extends BaseBuildResult {
  /** npm packages required by user code */
  npmRequired: string[];

  /** 
   * imported vendor paths and their dependents 
   * 
   *  eg: { "lodash/debounce": ["/src/1.js", "/src/2.js"] }
   */
  vendorImportedPaths: Map<string, string[]>;

  /** 
   * user file's dependents 
   * 
   *  eg: { "/src/utils.js": ["/src/1.js", "/src/2.js"] }
   */
  userFileDependents: Map<string, string[]>;
}
