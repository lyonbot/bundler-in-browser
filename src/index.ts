import type { BundlerInBrowser } from './BundlerInBrowser.js';

export { BundlerInBrowser } from './BundlerInBrowser.js';
export { MiniNPM } from './MiniNPM.js';
export { EventEmitter } from './EventEmitter.js';

export { wrapCommonJS, makeParallelTaskMgr, pathToNpmPackage } from './utils.js';

/** add sass support. requires `sass` installed */
export async function installSassPlugin(bundler: BundlerInBrowser) {
  (await import('./plugins/sass.js')).default(bundler);
}

/** add vue support. requires `vue@^3.2.14` installed */
export async function installVuePlugin(...args: Parameters<typeof import('./plugins/vue.js').default>) {
  (await import('./plugins/vue.js')).default(...args);
}
