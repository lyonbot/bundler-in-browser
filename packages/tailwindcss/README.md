# @bundler-in-browser/tailwindcss

A Tailwind CSS plugin for [bundler-in-browser](https://github.com/lyonbot/bundler-in-browser) that enables Tailwind CSS processing in the browser environment.

[![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![example](https://img.shields.io/badge/example-online-green)](https://lyonbot.github.io/bundler-in-browser/)

What works:

- directives (@tailwind, @apply, @layer, @variants, @responsive)
- configuration (theme, plugins, corePlugins etc.)
- scss and css-modules
- third-party plugins (need to be configured, see below)

## Installation

```bash
npm install bundler-in-browser @bundler-in-browser/tailwindcss
```

## Usage

```ts
import { BundlerInBrowser, installSassPlugin } from "bundler-in-browser";
import installTailwindPlugin from "@bundler-in-browser/tailwindcss";

const bundler = new BundlerInBrowser(fs);
await bundler.initialize();

await installSassPlugin(bundler);
await installTailwindPlugin(bundler, {
  rootDir: "/src",
  // pattern: /\.(css|scss|html|vue|jsx?|tsx?|md$/,   // defaults

  // Your tailwind configuration
  tailwindConfig: {
    corePlugins: {
      preflight: false, // Example: disable Tailwind CSS Reset. 👇 see caveats below.
    },
  },
});
```

And ensure your project contains a `/src/main.css` like this:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

And import it in the entry file:

```js
// in /src/index.js

import "./main.css";
```

## Caveats

### preflight (CSS Reset)

If you set `preflight: false` in `tailwindConfig`, you may need to import CSS Reset manually.

- **suggestion1**: use [@unocss/reset](https://unocss.dev/guide/style-reset#tailwind) instead

  ```js
  // based on Tailwind reset, minus the background color override for buttons
  // to avoid conflicts with UI frameworks.
  import "@unocss/reset/tailwind-compat.css";
  ```

- **suggestion2**: use tailwind's original preflight

  ⚠️ You need PostCSS + TailwindCSS to process [functions](https://v3.tailwindcss.com/docs/functions-and-directives#theme) like `theme('borderColor.DEFAULT', currentColor)`

  ```js
  // as css style (be processed by PostCSS)
  import "@bundler-in-browser/tailwindcss/preflight.css";

  // or, as js string (you shall process functions by yourself)
  import { preflight } from "@bundler-in-browser/tailwindcss";
  ```

### TailwindCSS Plugins

Most tailwind plugins relies on `tailwindcss/plugin`. You must **configure alias for tailwindcss** to support.

For vite:

```js
// vite.config.ts
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      tailwindcss: "@bundler-in-browser/tailwindcss",

      // or to pick if needed
      // "tailwindcss/plugin": '@bundler-in-browser/tailwindcss/plugin',
      // "tailwindcss/defaultConfig": '@bundler-in-browser/tailwindcss/defaultConfig',
      // "tailwindcss/defaultTheme": '@bundler-in-browser/tailwindcss/defaultTheme',
      // "tailwindcss/colors": '@bundler-in-browser/tailwindcss/colors',
    },
  },
});
```

For webpack:

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      tailwindcss: "@bundler-in-browser/tailwindcss",

      // or to pick if needed
      // "tailwindcss/plugin": '@bundler-in-browser/tailwindcss/plugin',
      // "tailwindcss/defaultConfig": '@bundler-in-browser/tailwindcss/defaultConfig',
      // "tailwindcss/defaultTheme": '@bundler-in-browser/tailwindcss/defaultTheme',
      // "tailwindcss/colors": '@bundler-in-browser/tailwindcss/colors',
    },
  },
};
```

### Use tailwind.config.js

For convenience, you can set `tailwindConfig: "/tailwind.config.js"`, but actually it's dangerous because we use `eval` to load it. And it can't load plugins.

It's recommended to pass an `tailwindConfig` object directly instead, which supports plugins.

## Configuration Options

### `rootDir`

The root directory to scan for files. Defaults to `/src`.

### `pattern`

The file pattern to scan. Defaults to `/\.(css|scss|sass|less|styl|html|vue|jsx?|tsx?|[cm][jt]s)|md$/`.

### `tailwindConfig`

The Tailwind CSS configuration object (recommended), or a string path to the configuration file in virtual file system.

Prefer to pass an object directly, which is safe and supports plugins.
