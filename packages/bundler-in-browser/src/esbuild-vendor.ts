import type esbuild from "esbuild-wasm";
import { createESBuildNormalLoader, createESBuildResolver, EsbuildHelper, type BaseBuildResult } from "./esbuild.js";
import { escapeRegExp } from "./utils/string.js";
import type { BundlerInBrowser } from "./BundlerInBrowser.js";

const vendorDir = '/vendor_dll';
const vendorSourceFile = '/vendor_dll/source.js';
const vendorSourceFileRegex = new RegExp(`^${escapeRegExp(vendorSourceFile)}$`);

/**
 * usage:
 * 
 * 1. finish npm install
 * 2. build
 */

export class VendorCodeEsbuildHelper extends EsbuildHelper<VendorBundleResult> {
  config: VendorBundleConfig;
  hash: string = '';

  constructor(bundler: BundlerInBrowser, config: VendorBundleConfig) {
    super(bundler);
    this.config = config;
    this.recomputeHash();
  }

  override makeEsbuildOptions() {
    const { bundler } = this;
    const { esbuildBaseOptions } = bundler;

    const vendorEntryPlugin: esbuild.Plugin = {
      name: 'vendor-entry',
      setup: (build) => {
        build.onResolve({ filter: vendorSourceFileRegex }, () => {
          return { path: vendorSourceFile, namespace: 'vendor-entry' };
        })
        build.onLoad({ filter: /./, namespace: 'vendor-entry' }, (args) => {
          if (args.path === vendorSourceFile) return {
            contents: this.generateSourceContent(),
            loader: 'js'
          };
          return null
        })
      },
    }

    const opts: esbuild.BuildOptions = {
      ...esbuildBaseOptions,

      entryPoints: [vendorSourceFile],
      outdir: vendorDir,
      plugins: [
        vendorEntryPlugin,
        this.getExternalPlugin(),
        ...bundler.vendorPlugins,
        ...bundler.commonPlugins,
        createESBuildResolver(bundler),
        createESBuildNormalLoader(bundler),
      ],
    };

    return opts;
  }

  /** generate the vendor file entry content */
  generateSourceContent() {
    const { exportPaths } = this.config;

    let entryContent = 'exports.deps = {\n'
    for (let i = 0; i < exportPaths.length; i++) {
      const dep = exportPaths[i];
      entryContent += `"${dep}": () => require("${dep}"),\n`
    }
    entryContent += '};'

    return entryContent;
  }

  /** recompute the hash of the vendor bundle. updates `.hash` then returns the new hash */
  recomputeHash(): string {
    const { config, esbuildBaseOptions } = this.bundler;
    const { exportPaths } = this.config;

    const portions = [
      Array.from(exportPaths).sort().join(','),
      JSON.stringify(config.define, (k, v) => {
        if (v instanceof RegExp) return v.toString();
        return v;
      }),
      JSON.stringify(esbuildBaseOptions),
    ];

    return this.hash = portions.join('\n');
  }

  override beforeBuild() {
    super.baseBeforeBuild();
  }

  override async build(): Promise<VendorBundleResult> {
    const { hash } = this
    const baseResult = await super.baseBuild();
    return {
      hash,
      exportPaths: this.config.exportPaths.slice(),
      ...baseResult,
    }
  }
}

export interface VendorBundleConfig {
  /** paths to export like ["lodash/debounce", "lodash/merge"] */
  exportPaths: string[];
}

export interface VendorBundleResult extends BaseBuildResult {
  hash: string;

  /** paths to export like ["lodash/debounce", "lodash/merge"] */
  exportPaths: string[];
}
