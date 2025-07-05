/**
 * in HMR patch, all imports will be replaced
 * 
 * ```js
 * // before:
 * import { useLocalStorage } from "@vueuse/core";
 * import { useStoreFoo } from "./stores/foo";
 * 
 * // after:
 * import { useLocalStorage } from "vue-shabby-hmr:inherit:HMR_ID";
 * import { useStoreFoo } from "vue-shabby-hmr:inherit:HMR_ID";
 * ```
 * 
 * then `fakeRequire()` will handle the virtual path, and return the latest `{ useStoreFoo, useLocalStorage, ... }`
 */
export const virtualPathInheritImportsPrefix = 'vue-shabby-hmr:inherit:';

/**
 * in compiled .vue script of normal build, this will be imported so we can
 * 
 * ```js
 * import __vueShabbyHMRExtra from "vue-shabby-hmr:runtime";
 * 
 * __vueShabbyHMRExtra.rememberDep("hmrId", { useStoreFoo, useLocalStorage, ... });
 * ```
 */
export const virtualPathRuntime = 'vue-shabby-hmr:runtime';
