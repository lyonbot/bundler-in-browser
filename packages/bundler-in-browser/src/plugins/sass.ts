import * as sass from 'sass';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";
import { processCSS } from './common.js';

export default function installSassPlugin(bundler: BundlerInBrowser) {
  const plugin: esbuild.Plugin = {
    name: "sass-loader",
    setup(build) {
      build.onLoad({ filter: /.scss$/ }, async (args) => {
        const fs = bundler.fs;
        let fullPath = args.path;
        let contents = fs.readFileSync(fullPath, 'utf8') as string;
        let result = await sass.compileStringAsync(contents, {
          style: 'expanded'
        });

        const css = result.css;
        return await processCSS(build, fullPath, css)
      })
    }
  }

  bundler.userCodePlugins.push(plugin);
}