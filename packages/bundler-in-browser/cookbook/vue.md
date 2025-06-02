# Vue

This document describe how to work with Vue.

## Options

You can pass options when `installVuePlugin`, or modify `vuePlugin.options` after installed.

```js
import { installVuePlugin } from "bundler-in-browser";

// Install Vue support with options
const vuePlugin = await installVuePlugin(bundler, {
  disableOptionsApi: false, // Set true to reduce vendor bundle size
  enableProdDevTools: false, // Set true if production build needs devtools
});

// or modify options after installed
vuePlugin.options.disableOptionsApi = true;
```

## Optimizing

### Faster npm install

For most cases, you can skip installing `vue`'s dependencies. They are for compiling, which is not needed in the browser.

```js
bundler.npm.options.packageJsonPatches.push((json) => {
  if (json.name === "vue") return { ...json, dependencies: {} }; // remove all dependencies
});
```

### Reuse `vue` from your app

If your app has `vue` bundled, you can reuse it, so that the bundler-in-browser can skip installing `vue`.

```js
// after await bundler.initialize()
bundler.config.externals.push("vue");
```

Then before running user code, you can provide a forged `require` function, to provide `vue`.

```js
import * as Vue from "vue";

// declare a "require" function
function myRequire(path) {
  if (path === "vue") return Vue;
  throw new Error("Unknown require: " + path);
}

// ...
// ... create bundler and build (see ../README.md)
// ...

// then, turn the built code into a function, with `require` as the first argument
const run = new Function("require", "return " + wrapCommonJS(buildResult.js));

// run user code, pass `myRequire` as `require`
run(myRequire);
```
