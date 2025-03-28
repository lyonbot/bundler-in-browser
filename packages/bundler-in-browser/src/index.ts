import type { BundlerInBrowser } from './BundlerInBrowser.js';
import type { InstallVuePluginOptions } from './plugins/vue.js';

export { BundlerInBrowser } from './BundlerInBrowser.js';
export { MiniNPM } from './MiniNPM.js';
export { EventEmitter } from './EventEmitter.js';

export { wrapCommonJS, makeParallelTaskMgr, ParallelTasksError, pathToNpmPackage } from './utils.js';

import * as forPlugins from './plugins/common.js';
export { forPlugins }

/** add sass support. requires `sass` installed */
export async function installSassPlugin(bundler: BundlerInBrowser) {
  (await import('./plugins/sass.js')).default(bundler);
}

/** add vue support. requires `vue@^3.2.14` installed */
export async function installVuePlugin(bundler: BundlerInBrowser, opts?: InstallVuePluginOptions) {
  (await import('./plugins/vue.js')).default(bundler, opts);
}
