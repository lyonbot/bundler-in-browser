import * as sass from 'sass';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";

export default function installSassPlugin(bundler: BundlerInBrowser) {
  const fs = bundler.fs;
  const plugin: esbuild.Plugin = {
    name: "sass-loader",
    setup(build) {
      build.onLoad({ filter: /.scss$/ }, async (args) => {
        let fullPath = args.path;
        let contents = fs.readFileSync(fullPath).toString('utf8');
        let result = await sass.compileStringAsync(contents, {
          style: 'expanded'
        });

        return {
          contents: result.css,
          loader: fullPath.endsWith('.module.scss') ? 'local-css' : 'css'
        }
      })
    }
  }

  bundler.userCodePlugins.push(plugin);
}