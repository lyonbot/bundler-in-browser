# bundler-in-browser

[![npm version](https://img.shields.io/npm/v/bundler-in-browser.svg)](https://www.npmjs.com/package/bundler-in-browser) [![github](https://img.shields.io/badge/github-source-blue)](https://github.com/lyonbot/bundler-in-browser) [![example](https://img.shields.io/badge/example-online-green)](https://lyonbot.github.io/bundler-in-browser/)

A powerful in-browser bundler that automatically installs npm packages, powered by esbuild-wasm. Perfect for building interactive code playgrounds, live demos, and browser-based development environments.

## Features

- 🚀 **Fast Bundling**: Powered by esbuild-wasm for high-performance bundling
- 📦 **Auto NPM Install**: Automatically installs and bundles npm dependencies
- 🔌 **Plugin System**: Support for TailwindCSS, Sass, Vue 3 SFC, and more
- 🗄️ **Vendor Caching**: Smart caching of vendor bundles for better performance
- 🌐 **Browser-Native**: Runs entirely in the browser - no server required

## Packages

- [bundler-in-browser](./packages/bundler-in-browser): the core bundler
- [@bundler-in-browser/tailwindcss](./packages/tailwindcss): TailwindCSS plugin for bundler-in-browser
