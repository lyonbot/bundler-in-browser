import { Volume } from "memfs";
import dayjs from "dayjs";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import { BundlerInBrowser, installSassPlugin, installVuePlugin, wrapCommonJS } from "bundler-in-browser";
import { fsData } from "./fsData.mjs";

const fsRaw = Volume.fromJSON(fsData);
const fs = new Proxy({}, {
  get(target, prop) {
    let raw = target[prop];
    if (raw) return raw;

    let fromFs = fsRaw[prop]
    if (typeof fromFs === "function") fromFs = fromFs.bind(fsRaw);
    return fromFs
  },
})

window.fs = fs;
main();

async function main() {
  const compiler = new BundlerInBrowser(fs);

  compiler.events.on('initialized', () => log('initialized'));
  compiler.events.on('npm:progress', (e) => log(`[npm] [${e.stage}] [${e.current} / ${e.total}] ${e.packageId}`));
  compiler.events.on('npm:install:done', (e) => log(`[npm] install:done`));

  compiler.events.on('compile:start', () => log('compile:start'));
  compiler.events.on('compile:usercode', (result) => log('compile:usercode', result));
  compiler.events.on('compile:vendor', (result) => log('compile:vendor', result));


  await compiler.initialize({
    esbuildWasmURL: esbuildWasmURL
  });

  await installSassPlugin(compiler);
  await installVuePlugin(compiler, { enableProdDevTools: true });

  const out = await compiler.compile()
    .catch(err => {
      console.error('Compile error:', err.errors);
      throw err
    })
  log('🎉 compiled', out);

  const style = document.createElement('style');
  document.head.appendChild(style);
  style.textContent = out.css;

  const fn = new Function(wrapCommonJS(out.js));
  fn();
}

function log(...args) {
  console.log(dayjs().format('HH:mm:ss'), ...args);
}