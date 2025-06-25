# esbuild-wasm-calls

this project is meant to collect all the `fs` calls from esbuild-wasm,
and see if we can provide a mocked `fs` to leverage esbuild-wasm's built-in module resolver, so we can drop `enhanced-resolve` which is a heavy dependency and slow.

## conclusion

when set `worker: false`, esbuild-wasm (aka. go's wasm) will not start new WebWorker, and it inherits the global `fs` from current scope.

esbuild-wasm relies on these fs calls:

```
read, write, stat, open, fstat, readdir, close, lstat, readlink
```

but esbuild's go program relies on stdout(1), stderr(2) to communicate with the js program:

- esbuild-wasm read commands from stdin(0)
- when started, it write version number to stdout
- after each build, it write to stdout
- error messages go to stderr

therefore, esbuild bundled [a modified version of go's wasm runtime](https://github.com/evanw/esbuild/blob/f4159a7b823cd5fe2217da2c30e8873d2f319667/scripts/esbuild.js#L240-L241),

- [patched the `self.fs.writeSync`](https://github.com/evanw/esbuild/blob/f4159a7b823cd5fe2217da2c30e8873d2f319667/lib/shared/worker.ts#L17) to get the stdout and stderr
- [patched the `self.fs.read`](https://github.com/evanw/esbuild/blob/f4159a7b823cd5fe2217da2c30e8873d2f319667/lib/shared/worker.ts#L43) to send commands via stdin

esbuild doesn't patch `self.fs.write` because go's wasm runtime [simply forwards the call to `self.fs.writeSync`](https://go.googlesource.com/go.git/+/refs/tags/go1.17rc1/misc/wasm/wasm_exec.js?autodive=0%2F%2F#61)
-- ‼️ which shall be cautious when providing a custom `fs` implementation

### how to patch `fs`

esbuild patches `fs` after `await esbuild.initialize()`, so we can patch again after that.

```js
const originalFs = memfs().fs;

self.fs = { ...originalFs };
await esbuild.initialize({
  wasmURL,
  worker: false, // <-- important
});

// now esbuild-wasm already patched self.fs
// we patch it again

const esbuildFsRead = self.fs.read;
const esbuildFsWriteSync = self.fs.writeSync;

self.fs.read = function (fd, ...args) {
  if (fd === 0) {
    esbuildFsRead(fd, ...args);
    return;
  }

  return originalFs.read(fd, ...args);
};

self.fs.write = function (...args) {
  // simply forward to writeSync
  const callback = args.pop();
  try {
    const n = this.writeSync(...args);
    callback(null, n);
  } catch (e) {
    callback(e, 0);
  }
};

self.fs.writeSync = function (fd, ...args) {
  if (fd === 1 || fd === 2) {
    // forward to esbuild's
    return esbuildFsWriteSync(fd, ...args);
  }

  return originalFs.writeSync(fd, ...args);
};
```
