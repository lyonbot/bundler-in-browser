# @bundler-in-browser/tailwindcss

A Tailwind CSS plugin for [bundler-in-browser](https://github.com/lyonbot/bundler-in-browser) that enables Tailwind CSS processing in the browser environment.

[![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![example](https://img.shields.io/badge/example-online-green)](https://lyonbot.github.io/bundler-in-browser/)

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
  rootDir: '/src',
  // pattern: /\.(css|scss|html|vue|jsx?|tsx?|md$/,   // defaults

  // Your tailwind configuration
  tailwindConfig: {
    corePlugins: {
      preflight: false, // Example: disable Tailwind's reset
    }
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
// in /src/index.js -- or any other entry file
import "./main.css";
```

### Use tailwind.config.js

> Note: this is not recommended, because we use `eval` to load the config file.

In the `installTailwindPlugin()` you can pass a file path to the Tailwind CSS configuration file:

```ts
await installTailwindPlugin(bundler, {
  rootDir: '/src',

  // ... other configuration ...
  tailwindConfig: "/tailwind.config.js",
});
```

And in the file system, create a `/tailwind.config.js` file like this:

```js
module.exports = {
  // Your tailwind config
}
```

## Advanced Usage

### Use tailwind plugins

Most tailwind plugins relies on `tailwindcss/plugin` and so on. To avoid duplicated bundling for your editor, please **configure alias for tailwindcss**.

For vite:

```js
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      "tailwindcss": '@bundler-in-browser/tailwindcss',

      // or to pick if needed
      // "tailwindcss/plugin": '@bundler-in-browser/tailwindcss/plugin',
      // "tailwindcss/defaultConfig": '@bundler-in-browser/tailwindcss/defaultConfig',
      // "tailwindcss/defaultTheme": '@bundler-in-browser/tailwindcss/defaultTheme',
      // "tailwindcss/colors": '@bundler-in-browser/tailwindcss/colors',
    }
  },
});
```

For webpack:

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      "tailwindcss": '@bundler-in-browser/tailwindcss',

      // or to pick if needed
      // "tailwindcss/plugin": '@bundler-in-browser/tailwindcss/plugin',
      // "tailwindcss/defaultConfig": '@bundler-in-browser/tailwindcss/defaultConfig',
      // "tailwindcss/defaultTheme": '@bundler-in-browser/tailwindcss/defaultTheme',
      // "tailwindcss/colors": '@bundler-in-browser/tailwindcss/colors',
    }
  },
};
```

## Configuration Options

### `rootDir`

The root directory to scan for files. Defaults to `/src`.

### `pattern`

The file pattern to scan. Defaults to `/\.(css|scss|sass|less|styl|html|vue|jsx?|tsx?|[cm][jt]s)|md$/`.

### `tailwindConfig`

The Tailwind CSS configuration. Can be a file path like `"/src/tailwind.config.js"` - but is dangerous cause we use `eval` to load it.

You can also pass an object directly, which is recommended.
