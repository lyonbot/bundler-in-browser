# Under the Hood

When you call `bundler.build()`, it performs the following steps:

1. build & bundle user code, and collect and externalize all dependencies.

   - collects all imported paths like `["canvas-confetti", "lodash/debounce"]`, excluding the blocked by `config.externals`

   - output a CommonJS module. it may contains `require("some-dependency")`

2. (if dependencies mismatch the cached vendor bundle)

   1. install missing npm packages.

   2. create vendor bundle, which exports all dependent module getters as a object, like

      ```js
      export const deps = {
        "canvas-confetti": () => ...,
        "lodash/debounce": () => ...,
      };
      ```

3. concat user code and vendor bundle.

   - the output javascript is in UMD format, so you can run it directly, or wrap into IIFE to retrieve the `exports` of user code.
