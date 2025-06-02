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
const run = new Function("return " + wrapCommonJS(buildResult.js));
const userExports = run();

console.log("user code exports:", userExports);

// Apply any generated CSS
if (buildResult.css) {
  const style = document.createElement("style");
  style.textContent = buildResult.css;
  document.head.appendChild(style);
}
```

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

## Cookbook

### [**📘 Use External Libraries**](./cookbook/use-external-libraries.md)

↑ click title to see more details.

bundler-in-browser allows user to `import` from npm, or your pre-defined modules.

- add pre-defined modules (use `bundler.config.externals`)
- configure npm, blocklist, custom registry
- vendor bundle (dll cache)

### [**📘 Under the Hood**](./cookbook/under-the-hood.md)

↑ click title to learn how `bundler.build()` works.
