import type { BundlerInBrowser } from './BundlerInBrowser.js';
import type { InstallVuePluginOptions, VuePluginInstance, OptionsPatcher, VueSfcCacheItem } from './plugins/vue.js';

import * as npm from './npm/index.js';
export { npm };

export { BundlerInBrowser } from './BundlerInBrowser.js';
export { MiniNPM } from './MiniNPM.js';
export { EventEmitter } from './EventEmitter.js';

export { wrapCommonJS, pathToNpmPackage } from './utils/string.js';
export { makeParallelTaskMgr, ParallelTasksError } from './parallelTask.js';

/** add sass support. requires `sass` installed */
export async function installSassPlugin(bundler: BundlerInBrowser) {
  (await import('./plugins/sass.js')).default(bundler);
}

/** add vue support. requires `vue@^3.2.14` installed */
export async function installVuePlugin(bundler: BundlerInBrowser, opts?: InstallVuePluginOptions): Promise<VuePluginInstance> {
  return (await import('./plugins/vue.js')).default(bundler, opts);
}
export { type VuePluginInstance, type OptionsPatcher, type VueSfcCacheItem }
