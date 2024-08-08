# bundler-in-browser

[![npm version](https://img.shields.io/npm/v/bundler-in-browser.svg)](https://www.npmjs.com/package/bundler-in-browser) [![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![playground](https://img.shields.io/badge/playground-online-green)](https://lyonbot.github.io/bundler-in-browser/)

a bundler in browser, auto install npm packages, powered by esbuild-wasm

## Usage

```sh
npm install bundler-in-browser memfs

# memfs is optional, but recommended
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
  // esbuildWasmURL: `https://cdn.jsdelivr.net/npm/esbuild-wasm@${BundlerInBrowser.esbuildVersion}/esbuild.wasm`,  // optional
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

### npm

- You can create `/package.json` to specify dependencies version

- The builtin npm client "MiniNPM" has its own cache and lock file, so it can quickly install dependencies.

- Change npm registry: `bundler.npm.options.registryUrl = "https://mirrors.cloud.tencent.com/npm";`

- To observe progress: `bundler.npm.events.on("progress", e => console.log("[npm]", e));`

### vendor bundle (npm dependencies)

If user code changed but no new `import` statements, vendor-bundling will be skipped (using previous cached bundle).

You can export vendor bundle, and load it in another `BundlerInBrowser` instance.

```js
const vendor = bundler.dumpVendorBundle();
saveToDisk("myVendor.json", vendor);

// ... later somewhere else ...

const loadedVendor = loadFromDisk("myVendor.json");
bundler.loadVendorBundle(loadedVendor);
```

To clear vendor cache: `bundler.loadVendorBundle(null);`
