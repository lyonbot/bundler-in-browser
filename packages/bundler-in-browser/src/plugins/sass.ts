import * as sass from 'sass';
import type { BundlerInBrowser } from "../BundlerInBrowser.js";
import type esbuild from "esbuild-wasm";

export default function installSassPlugin(bundler: BundlerInBrowser) {
  const plugin: esbuild.Plugin = {
    name: "sass-loader",
    setup(build) {
      build.onLoad({ filter: /\.scss$/ }, async (args) => {
        let fullPath = args.path;
        let contents = bundler.fs.readFileSync(fullPath, 'utf8') as string;
        let result = await sass.compileStringAsync(contents, {
          style: 'expanded'
        });

        const css = result.css;
        return bundler.pluginUtils.applyPostProcessors(args, {
          contents: css,
          loader: /\.module\.\w+$/.test(fullPath) ? 'local-css' : 'css',
        })
      })
    }
  }

  bundler.userCodePlugins.push(plugin);
}