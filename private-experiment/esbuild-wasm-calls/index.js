import esbuild from 'esbuild-wasm'
import wasmURL from 'esbuild-wasm/esbuild.wasm?url'
import { memfs } from 'memfs'

const { fs } = memfs({
  '/node_modules/foobar/package.json': '{ "name": "foobar", "main": "main.js" }',
  '/node_modules/foobar/main222.js': 'console.log(2)',
  '/src/index.js': 'import "foobar"; import "foobar/main222"; console.log(1)',
  '/src/index.css': 'body { color: red; }',
  '/src/index.svg': '<svg></svg>',
})
fs.symlinkSync('/node_modules/foobar/main222.js', '/node_modules/foobar/main.js')

self.fs = {
  ...fs,
  // patch to match go's wasm runtime behavior
  write(...args) {
    const callback = args.pop()
    try {
      const n = this.writeSync(...args)
      callback(null, n)
    } catch (e) {
      callback(e, 0)
    }
  },
}

const actions = new Set()
for (const key of Object.keys(self.fs)) {
  if (typeof self.fs[key] === 'function') {
    const fn = self.fs[key]
    self.fs[key] = (...args) => {
      console.log(key, args)
      actions.add(key)
      return fn.apply(self.fs, args)
    }
  }
}

async function main() {
  await esbuild.initialize({
    wasmURL,
    worker: false,
  })

  const esbuildFsRead = self.fs.read
  self.fs.read = function (fd, buffer, offset, length, position, callback) {
    if (fd === 0) return esbuildFsRead(fd, buffer, offset, length, position, (err, n) => {
      callback(err, n)
    })

    console.log('fs.read', [...arguments]);
    return fs.read(fd, buffer, offset, length, position, callback)
  }

  const ans = await esbuild.build({
    entryPoints: ['/src/index.js', '/src/index.css'],
    outdir: '/dist',
    sourcemap: true,
    sourcesContent: false,
    bundle: true,
    platform: 'browser',
  })

  console.log(ans)
  for (const file of ans.outputFiles) {
    console.log(file.text)
  }

  console.log('fs actions = ' + Array.from(actions).join(', '))
}

main().catch(err => { console.error(err); process.exit(1); })
