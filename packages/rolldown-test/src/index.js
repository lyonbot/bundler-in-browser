async function main() {
  // const { memfs } = await import('@napi-rs/wasm-runtime/fs')
  // memfs()
  const rolldown = await import('rolldown')

  // modified packages/rolldown-test/node_modules/@rolldown/browser/dist/index.browser.mjs
  // add export { __fs } from "./rolldown-binding.wasi-browser.js";

  /** @type {import('memfs').MemFs} */
  const fs = rolldown.__fs;
  fs.mkdirSync('/src')
  fs.writeFileSync('/src/index.js', `
    import "./app";
    console.log("🌏 index");
  `);
  fs.writeFileSync('/src/app.js', `
    import { foobarSay } from "foobar";

    let scopeId = Math.random().toString(36).slice(2);

    let count = 0;
    console.log("🌏 app @" + scopeId);
    foobarSay()

    if (import.meta.hot) {
      import.meta.hot.accept(() => {
        count++;
        console.log("🔥 hot " + count + " at " + scopeId);
        foobarSay();
      })
    }
  `)

  fs.mkdirSync('/node_modules/foobar', { recursive: true })
  fs.writeFileSync('/node_modules/foobar/index.js', `
    export const foobarSay = () => console.log("🌏 foobar")
  `)
  fs.writeFileSync('/node_modules/foobar/package.json', JSON.stringify({
    name: 'foobar',
    main: 'index.js',
  }))

  // console.log('rolldown', rolldown, memfs)
  const b = await rolldown.rolldown({
    cwd: '/',
    input: './src/index.js',
    platform: 'browser',
    plugins: [
      {
        name: 'wtf',
        async resolveId(input) {
          console.log('resolveId', input)
        }
      },
    ],
    experimental: {
      hmr: {
        // https://github.com/rolldown/rolldown/blob/6bb8d8da587723c6a0e67397412a0d649bfcf684/crates/rolldown/src/module_loader/runtime_module_task.rs#L84
        // implement: 'js',
        host: 'localhost',
        port: 12345,
      },
    },
  })
  console.log('bundler', b)
  const r = await b.generate()
  console.log(r.output[0].code)
  runCode(r.output[0].code)

  // ----------------------------------------------
  console.log('----------------------------------------------')
  {
    fs.writeFileSync('/node_modules/foobar/index.js', `
      export const foobarSay = () => console.log("🌏 bang!")
    `)
    const patches = await b.generateHmrPatch(['/node_modules/foobar/index.js'])
    console.log('patches', patches.code, patches.hmrBoundaries)
    runCode(patches.code)
  }

  // ----------------------------------------------
  console.log('----------------------------------------------')
  {
    fs.writeFileSync('/node_modules/foobar/index.js', `
      export const foobarSay = () => console.log("🌏 bang again!")
    `)
    const patches = await b.generateHmrPatch(['/node_modules/foobar/index.js'])
    console.log('patches', patches.code, patches.hmrBoundaries)
    runCode(patches.code)
  }
}

function runCode(code) {
  const fn = new Function(code)
  fn.call(globalThis)
}

main().catch(err => { console.error(err); })