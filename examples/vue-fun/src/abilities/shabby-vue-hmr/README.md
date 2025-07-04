# Vue HMR

> ## 💩 CRAP WARN
>
> 1. for now bundler-in-browser doesn't really support HMR, but i implemented a simple one that works for `.vue` files. (if other file modified, a force reload will happen)
>
> 2. in conjunction with `../vue-inspector/for-bundler`
>
> 3. use Vue's development build (`vue/dist/vue.esm-bundler.js`)

Vue provides HMR ability via `__VUE_HMR_RUNTIME__`.
and when bundler-in-browser enables vue HMR, it will generate a `__VUE_HMR_RUNTIME__.createRecord(hmrId, sfcMain)` function.

1. **rerender**: calls `__VUE_HMR_RUNTIME__.rerender(hmrId, renderFn)`.

   happens if only `<template>` changes. all state remains untouched.

2. **reload**: calls `__VUE_HMR_RUNTIME__.reload(hmrId, sfcMain)`

   happens when `<script>` changes, but no new import added (maybe someday bundler-in-browser will support better)

   be careful that imports shall be inherited from existing instance.

3. ~~**style reload**~~: because bundler-in-browser always bundles all style into a .css file, so...

   always rebuild whole project to get the latest css. (and TailwindCSS will benefit too)

## handle dependencies of .vue files

if a module can be HMR patched, its `import`s shall load from existing instance.

to implement this, I inject this code to **compiled vue sfc script**, to store deps for next HMR patching:

```js
// ... previous compiled script ...

// remember all imported symbols and references
import * as __vueShabbyHMRExtra from "vue-shabby-hmr:runtime";
__vueShabbyHMRExtra.rememberDep("hmrId", { useStoreFoo, useLocalStorage, ... });
```

that applies to normal build.

and **in the HMR patch**, all imports will be replaced:

```js
// before:
import { useLocalStorage } from "@vueuse/core";
import { useStoreFoo } from "./stores/foo";

// after:
import { useLocalStorage } from "vue-shabby-hmr:inherit:HMR_ID";
import { useStoreFoo } from "vue-shabby-hmr:inherit:HMR_ID";
```

when HMR patch is applied, the `fakeRequire()` will handle the virtual path, and return the stored `{ useStoreFoo, useLocalStorage, ... }`

## generate HMR patch

in `tryBuildHMRPatch(vuePlugin, changedFiles)`, it will try to build a HMR patch, if can do a hot update.

1. check the changed file list, if can't do HMR, return nothing.

2. if can do HMR, activate a special ESBuild plugin (replacing entry point, and deps of vue), and do a build.

3. the HMR patch only contains js, no css. so after making a HMR patch, please rebuild whole project, and use the latest css.
