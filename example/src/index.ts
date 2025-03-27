import { Volume } from "memfs";
import dayjs from "dayjs";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import { BundlerInBrowser, installSassPlugin, installVuePlugin, wrapCommonJS } from "bundler-in-browser";
import { fsData } from "./fsData.js";

import type { PartialMessage } from 'esbuild-wasm'

const fsRaw = Volume.fromJSON(fsData);
const fs = new Proxy({} as typeof fsRaw, {
  get(target: any, prop) {
    let raw = target[prop];
    if (raw) return raw;

    let fromFs = (fsRaw as any)[prop]
    if (typeof fromFs === "function") fromFs = fromFs.bind(fsRaw);
    return fromFs
  },
})

// @ts-ignore
window.fs = fs;
main();

const pre = document.getElementById('compile-log')!;

async function main() {
  const compiler = new BundlerInBrowser(fs as any);

  compiler.events.on('initialized', () => log('initialized'));
  compiler.events.on('npm:progress', (e) => log(`[npm] [${e.stage}] [${e.current} / ${e.total}] ${e.packageId}`));
  compiler.events.on('npm:install:done', () => log(`[npm] install:done`));

  compiler.events.on('compile:start', () => log('compile:start'));
  compiler.events.on('compile:usercode', (result) => log('compile:usercode', result));
  compiler.events.on('compile:vendor', (result) => log('compile:vendor', result));


  await compiler.initialize({
    esbuildWasmURL: esbuildWasmURL
  });

  await installSassPlugin(compiler);
  await installVuePlugin(compiler, { enableProdDevTools: true });

  const out = await compiler.compile()
    .catch((err: Error & { errors?: PartialMessage[] }) => {
      console.error('Compile error:', err.errors);
      log('❌ Compile error. ' + err.message);
      err.errors?.forEach((e, i) => {
        log(`(${i + 1}) ${e.text}\n${e.location?.file}:${e.location?.line}:${e.location?.column}`);
      });
      throw err
    })
  log('🎉 compiled', out);


  // insert compiled css
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.textContent = out.css;

  // run compiled js
  const fn = new Function(wrapCommonJS(out.js));
  fn();

  // remove log
  pre.remove();
}

function log(...args: any[]) {
  const t = dayjs().format('HH:mm:ss');
  console.log(t, ...args);
  const div = document.createElement('div');
  div.textContent = t + ' ' + args.join(' ');
  pre.appendChild(div);
  pre.scrollTop = pre.scrollHeight;
}