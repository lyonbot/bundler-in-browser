import * as esbuild from 'esbuild-wasm';

export function getDefaultBuildConfiguration() {
  return {
    /** 
     * the entrypoint file path.
     * 
     * if not set, will try `/index.js`, `/src/index.js` etc.
     */
    entrypoint: '',

    /**
     * all extensions can be resolved (may omit extname when importing).
     */
    extensions: ['.js', '.mjs', '.cjs', '.json', '.wasm', '.ts', '.tsx', '.jsx'],

    /**
     * preprocessors for code files, including js, css, ts, json, txt etc.
     * 
     * all preprocessors will be run in order, and the result will be passed to the next processor.
     * 
     * User and BundlerInBrowser plugins may update this list. Be cautious for path -- use `args.path.replace(/[?#!].*$/, '')` if needed
     */
    postProcessors: [] as Array<{
      name: string,
      /**
       * test file path or a function to test file path.
       * 
       * @example /\.css$/i
       * @example args => /\.css$/.test(args.path) && args.suffix.includes('?type=xxx')
       */
      test: RegExp | ((args: esbuild.OnLoadArgs) => boolean),
      /**
       * process the file, modify `result`
       * 
       * @remarks - use `bundler.pluginUtils.contentsToString(result.contents)` to read as string
       */
      process: (args: esbuild.OnLoadArgs, result: esbuild.OnLoadResult) => void | Promise<void>
    }>,

    /**
     * exclude dependencies from bundle.
     * 
     * - string `"@foo/bar"` also matches `@foo/bar/baz.js`
     * - string supports wildcards like `"*.png"`
     * - regexp `/^vue$/` will NOT match `vue/dist/vue.esm-bundler.js`
     */
    externals: [] as (string | RegExp)[],

    minify: true,

    /** eg. { "process.env.NODE_ENV": "production" } */
    define: {} as Record<string, string>,

    /** 
     * your custom `define` function name. defaults to `"define"` 
     * 
     * Note: the function must have `amd` flag ( will check `define.amd == true` )
     */
    amdDefine: 'define',

    /** 
     * in UMD mode, module will expose at `self[umdGlobalName]` (usually self is `window`) 
     */
    umdGlobalName: '',

    /** 
     * in UMD mode, your mock *require(id)* function. set to null to disable.
     * 
     * this shall be a expression like `"window.myRequire"`, pointing to a function, which looks like `(id) => { return ... }`
     * 
     * @note you won't need this if `external` not set.
     */
    umdGlobalRequire: '',
  };
}

export type BuildConfiguration = ReturnType<typeof getDefaultBuildConfiguration>;
