# bundler-in-browser

[![npm version](https://img.shields.io/npm/v/bundler-in-browser.svg)](https://www.npmjs.com/package/bundler-in-browser) [![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![playground](https://img.shields.io/badge/playground-online-green)](https://lyonbot.github.io/bundler-in-browser/)

a bundler in browser, auto install npm packages, powered by esbuild-wasm

## Usage

```sh
npm install bundler-in-browser esbuild-wasm@0.23.0 memfs

# 1. remember the version of esbuild-wasm!
# 2. memfs is optional, but recommended
```

```ts
import { BundlerInBrowser, wrapCommonJS } from "bundler-in-browser";
import { Volume } from "memfs";

const fs = Volume.fromJSON({
  "/index.js": `
    import confetti from "canvas-confetti";

    confetti();
    setInterval(() => { confetti() }, 3000);

    const elt = document.createElement('h1');
    elt.textContent = 'BundlerInBrowser! Works!';
    elt.style.cssText = 'text-align: center; font-size: 32px; margin-top: 30vh;';
    document.body.appendChild(elt);
  `,
});

const bundler = new BundlerInBrowser(fs);
await bundler.initialize({
  esbuildWasmURL: "https://cdn.jsdelivr.net/npm/esbuild-wasm@0.23.0/esbuild.wasm", // match your installed version!
});

// compile!
const out = await bundler.compile({
  entrypoint: "/index.js",
});

console.log("compiled", out);

// run the code (it's in CommonJS format, you can use `wrapCommonJS` to wrap it)
const run = new Function(wrapCommonJS(out.js));
run();

// if you have css...
const style = document.createElement("style");
style.textContent = out.css;
document.head.appendChild(style);
```

## How it Works?

The bundler has 3 stages:

1. **`bundleUserCode`**: compile and bundle user code, collect npm dependencies, yields CommonJS module
2. **`bundleVendor`**: install npm dependencies, then make a vendor bundle (like dll)
3. **`concatUserCodeAndVendors`**: concat user code and vendor dll into one result (js + css)

Calling `compile()` will run all of 3 stages.

If you only need stage 1, use `bundler.bundleUserCode()` and it tells you what dependencies are required.

## Plugins

### `installSassPlugin`

Add sass support. Requires `sass` installed.

```ts
import { BundlerInBrowser, installSassPlugin } from "bundler-in-browser";

const bundler = new BundlerInBrowser(fs);
await bundler.initialize({ ... });

await installSassPlugin(bundler);

// now you can compile .scss/.sass files
const out = await bundler.compile(...);
```

### `installVuePlugin`

Add vue 3 sfc (.vue) support. Requires `vue@^3.2.14` installed.

```ts
import { BundlerInBrowser, installVuePlugin } from "bundler-in-browser";

const bundler = new BundlerInBrowser(fs);
await bundler.initialize({ ... });

await installVuePlugin(bundler, {
  disableOptionsApi: false, // (default: false) enable this to make vendor bundle smaller
  enableProdDevTools: false,  // (default: false) set true if PROD build requires devtool too
});

// now you can compile .vue files
const out = await bundler.compile(...);
```

## Tricks

For NPM:

- You can specify dependencies version in `/package.json`

- When new npm required, built-in npm client "MiniNPM" can quickly install them -- it has cache and lock file.

- Change npm registry: `bundler.npm.options.registryUrl = "https://mirrors.cloud.tencent.com/npm";`

- To observe progress: `bundler.npm.events.on("progress", e => console.log("[npm]", e));`

For bundler:

- Stage 2 may auto-skipped, if no new dependencies found in user code.

- To reset "stage 2" vendor cache: `bundler.lastVendorBundle = undefined;`
