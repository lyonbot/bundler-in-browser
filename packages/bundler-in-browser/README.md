# bundler-in-browser

[![npm version](https://img.shields.io/npm/v/bundler-in-browser.svg)](https://www.npmjs.com/package/bundler-in-browser) [![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![example](https://img.shields.io/badge/example-online-green)](https://lyonbot.github.io/bundler-in-browser/)

A powerful in-browser bundler that automatically installs npm packages, powered by esbuild-wasm. Perfect for building interactive code playgrounds, live demos, and browser-based development environments.

## Features

- 🚀 **Fast Bundling**: Powered by esbuild-wasm for high-performance bundling
- 📦 **Auto NPM Install**: Automatically installs and bundles npm dependencies
- 🔌 **Plugin System**: Support for TailwindCSS, Sass, Vue 3 SFC, and more
- 🗄️ **Vendor Caching**: Smart caching of vendor bundles for better performance
- 🌐 **Browser-Native**: Runs entirely in the browser - no server required

## Installation

```sh
npm install bundler-in-browser

# Optional but recommended for virtual filesystem support
npm install @zenfs/core path-browserify
```

Then, configure your project, alias `path` to `path-browserify`:

- **Vite**: open `vite.config.ts`, add `"path": "path-browserify"` into `resolve.alias`
- **Webpack**: open `webpack.config.js`, add `"path": "path-browserify"` into `resolve.alias`
- **Rollup**: refer to [@rollup/plugin-alias](https://www.npmjs.com/package/@rollup/plugin-alias)

## Quick Start

Here's a simple example that bundles and runs code with a third-party package:

```ts
import { BundlerInBrowser, wrapCommonJS } from "bundler-in-browser";
import { fs } from "@zenfs/core";

// Create a virtual filesystem with your source code
fs.mkdirSync("/src");
fs.writeFileSync(
  "/src/index.js",
  `
    import confetti from "canvas-confetti";

    confetti();
    setInterval(() => { confetti() }, 3000);

    const elt = document.createElement('h1');
    elt.textContent = 'BundlerInBrowser! ' + FOO;
    elt.style.cssText = 'text-align: center; font-size: 32px; margin-top: 30vh;';
    document.body.appendChild(elt);
  `
);

// Initialize the bundler
const bundler = new BundlerInBrowser(fs);
await bundler.initialize();

// Build your code
bundler.config.entrypoint = "/src/index.js";
bundler.config.define.FOO = '"awesome!"'; // Define global constants

// if failed, may throw Error with { errors }
const buildResult = await bundler.build();

// it returns { js, css } and the `js` is a CommonJS module
// Execute the js (use `wrapCommonJS()` to convert CommonJS into IIFE function)
const run = new Function(wrapCommonJS(buildResult.js));
run();

// Apply any generated CSS
if (buildResult.css) {
  const style = document.createElement("style");
  style.textContent = buildResult.css;
  document.head.appendChild(style);
}
```

## How It Works

When you call `bundler.build()`, it performs the following steps:

1. build & bundle user code, and collect and externalize all dependencies.

   - collects all imported paths like `["canvas-confetti", "lodash/debounce"]`, excluding the blocked by `config.externals`

   - output a CommonJS module. it may contains `require("some-dependency")`

2. (if dependencies mismatch the cached vendor bundle)

   1. install missing npm packages.

   2. create vendor bundle, which exports all dependent module getters as a object, like

      ```js
      export const deps = {
        "canvas-confetti": () => ...,
        "lodash/debounce": () => ...,
      };
      ```

3. concat user code and vendor bundle.

   - the output javascript is in UMD format, so you can run it directly, or wrap into IIFE to retrieve the `exports` of user code.

## Plugins

### TailwindCSS Support

See [tailwindcss plugin](https://github.com/lyonbot/bundler-in-browser/tree/main/packages/tailwindcss) for more details.

### Sass Support

Add support for `.scss` and `.sass` files:

```ts
import { BundlerInBrowser, installSassPlugin } from "bundler-in-browser";

const bundler = new BundlerInBrowser(fs);
await bundler.initialize();

// Install Sass support
await installSassPlugin(bundler);

// Now you can compile files with .scss/.sass extensions
```

### Vue 3 Support

Add support for Vue 3 Single File Components (`.vue` files):

```ts
import { BundlerInBrowser, installVuePlugin } from "bundler-in-browser";

const bundler = new BundlerInBrowser(fs);
await bundler.initialize();

// Install Vue support with options
await installVuePlugin(bundler, {
  disableOptionsApi: false, // Set true to reduce vendor bundle size
  enableProdDevTools: false, // Set true if production build needs devtools
});

// Now you can compile .vue files
```

## Caveats

### NPM Configuration

The built-in NPM client can install packages automatically. It works with the built-in resolver, with dedicated directory structure under-the-hood.

You can configure it with the following options:

- Create a `/package.json` to **specify package versions**

  ```json
  {
    "dependencies": {
      "canvas-confetti": "^1.5.1"
    }
  }
  ```

- **Custom npm Registry**:

  ```js
  bundler.npm.options.registryUrl = "https://mirrors.cloud.tencent.com/npm";
  ```

- **Prevent Installing Specific Packages**: - please use it in conjunction with `bundler.config.externals`

  ```js
  bundler.npm.options.blocklist = [
    "@vue/compiler-core",
    "@vue/compiler-dom",
    "@vue/compiler-sfc",
    "@vue/server-renderer",
    // support RegExp too:   /^@vue\/compiler-.*$/
  ];
  ```

- **Progress Events**: Monitor installation progress:

  ```js
  bundler.events.on("npm:progress", (e) => console.log("[npm]", e));
  bundler.events.on("npm:install:error", (event) => console.log("[npm] install failed", event.errors));
  bundler.events.on("npm:install:done", () => console.log("[npm] install:done"));
  bundler.events.on("npm:packagejson:update", (newPackageJSON) => console.log("[newPackageJSON]", newPackageJSON));
  ```

### Vendor Bundle Management

Building vendor bundle is slow, so you can reuse it. It depends on `bundler.config` and dependencies of user code.

```js
// Export vendor bundle for reuse
const vendor = bundler.dumpVendorBundle();
saveToDisk("myVendor.json", vendor);

// Load vendor bundle in another instance
const loadedVendor = loadFromDisk("myVendor.json");
bundler.loadVendorBundle(loadedVendor);

// Clear vendor cache
bundler.loadVendorBundle(null);
```

The vendor bundle is automatically cached and reused when dependencies haven't changed, improving compilation speed.
