# Use External Libraries

bundler-in-browser allows user to `import` from npm, or your pre-defined modules.

## pre-defined modules

You can add pre-defined modules into `bundler.config.externals`, so that bundler-in-browser will not install them via npm.

Then in the built code, there will be `require("your-module")` or `require("your-module/path/to/file")`, depends on how user code imports.
All you need is to prepend a `require` function before the bundled user code.

There is also a example to refer: [reuse `vue` from your app](./vue.md#reuse-vue-from-your-app).

```js
import { BundlerInBrowser, wrapCommonJS } from "bundler-in-browser";
import { fs } from "@zenfs/core";

fs.mkdirSync("/src");
fs.writeFileSync(
  "/src/index.js",
  `
    import { version } from "my-awesome-platform";
    console.log("platform version:", version);

    export default { hello: "world" };
  `
);

// Initialize the bundler
// and add "my-awesome-platform" into externals

const bundler = new BundlerInBrowser(fs);
await bundler.initialize();

bundler.config.externals.push("my-awesome-platform");

// Build user code
// and turn into a function to execute

const buildResult = await bundler.build();
const run = new Function("require", "return " + wrapCommonJS(buildResult.js));

// the `run(require)` will return things that user code exports
// and the named parameter `require` shall return the pre-defined module, aka. the externals

// example of my custom require function
function myRequire(path) {
  if (path === "my-awesome-platform") {
    // import {version,postMessage} from "my-awesome-platform";
    return {
      version: "1.0.0",
      postMessage,
    };
  }
  if (path === "my-awesome-platform/postMessage") {
    // import postMessage from "my-awesome-platform/postMessage";
    return {
      default: postMessage,
    };
  }

  throw new Error("Unknown require: " + path);
}

// you can also list all necessary externals in `buildResult.externals`
// to tailor the custom require function
// it's a string array, like ["my-awesome-platform", "my-awesome-platform/postMessage"]
console.log("user code requires:", buildResult.externals);

// execute user code
// and pass the `myRequire` function as the `require` in user code
const userCodeExports = run(myRequire);
console.log("user code exports:", userCodeExports);
```

## npm packages

If not hit `externals` list, bundler-in-browser will install npm packages automatically, and bundle them.

### specify package versions

You can create `/package.json` to specify package versions, and bundler-in-browser will install them.

Or you can call `await bundler.addDepsToPackageJson(["some-package@^1.2.3"])` to add dependencies to `/package.json`.

### block packages

You can block packages with `bundler.npm.options.blocklist`. Add string or RegExp to blocklist.

```js
bundler.npm.options.blocklist.push(
  /^@vue\/compiler-.*$/, // block all vue compilers - using RegExp
  "@vue/server-renderer" // block @vue/server-renderer
);
```

### custom npm registry

You can specify a custom npm registry url with `bundler.npm.options.registryUrl`.

```js
bundler.npm.options.registryUrl = "https://mirrors.cloud.tencent.com/npm";
```

### display progress

```js
bundler.events.on("npm:progress", (e) => console.log("[npm]", e));
bundler.events.on("npm:install:error", (event) => console.log("[npm] install failed", event.errors));
bundler.events.on("npm:install:done", () => console.log("[npm] install:done"));
bundler.events.on("npm:packagejson:update", (newPackageJSON) => console.log("[newPackageJSON]", newPackageJSON));
```

### patching packages

you can modify package.json before installing it, by adding `bundler.npm.options.packageJsonPatches`.

```js
bundler.npm.options.packageJsonPatches.push((json) => {
  if (json.name === "vue") {
    json.dependencies = {}; // remove all dependencies - not used in the browser
    return json;
  }

  if (json.name === "antd") {
    // bundling "antd" is too slow, so we just use the minified & bundled version

    json.main = "dist/antd.min.js";
    delete json.module; // avoid using es modules

    json.dependencies = {
      // remove all dependencies, except for "dayjs"
      dayjs: json.dependencies.dayjs,
    };
    return json;
  }
});
```

## Vendor Bundle

bundler-in-browser will bundle downloaded npm packages into a dll (vendor bundle). it's separated from user code, and can be reused.

if user imports from new packages or paths, the vendor bundle will be rebuilt. which might take time to install from npm, and bundle them. (only imported paths will be bundled)

a vendor bundle can be exported or imported, so you can reuse for new builds.

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
