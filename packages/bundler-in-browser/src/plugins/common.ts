import type esbuild from "esbuild-wasm";

const sym = Symbol.for('bib:postcss')

declare module 'esbuild-wasm' {
  interface BuildOptions {
    [sym]?: import('postcss').Processor;
  }
}

export function setPostcssProcessor(build: esbuild.PluginBuild, processor: import('postcss').Processor) {
  build.initialOptions[sym] = processor;
}

/**
 * for plugins that generate css, run this.
 * 
 * 1. invoke `postcss` if exists
 * 2. set the `loader` to `local-css` if the file name ends with `.module.XXX`
 */
export async function processCSS(build: esbuild.PluginBuild, filePath: string, content: string): Promise<esbuild.OnLoadResult> {
  const result: esbuild.OnLoadResult = {
    contents: '',
    loader: /\.module\.\w+$/.test(filePath) ? 'local-css' : 'css',
  }

  const postcss = build.initialOptions[sym];
  if (!postcss) {
    result.contents = content;
    return result;
  }

  try {
    const postcssResult = await postcss.process(content, {
      from: filePath,
    })
    result.contents = postcssResult.css;
    result.warnings = postcssResult.warnings().map(w => ({
      text: w.text,
      location: {
        file: filePath,
        line: w.line,
        column: w.column,
      },
      detail: w,
    }))
  } catch (error) {
    const postcssError = error as {
      name: string;
      message: string;
      reason: string;
      file?: string;
      line?: number;
      column?: number;
    };

    result.errors = [{
      text: `[PostCSS ${postcssError.name}] ${postcssError.message}`,
      location: {
        file: filePath,
        line: postcssError.line,
        column: postcssError.column,
      }
    }]
  }

  return result;
}
