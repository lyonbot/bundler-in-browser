import { fs } from "@zenfs/core";
import { dirname } from "path";
import dayjs from "dayjs";
import esbuildWasmURL from "esbuild-wasm/esbuild.wasm?url";
import { BundlerInBrowser, installSassPlugin, installVuePlugin, wrapCommonJS } from "bundler-in-browser";
import { fsData } from "./fsData.js";

import type { PartialMessage } from 'esbuild-wasm'

Object.entries(fsData).forEach(([path, content]) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, content);
})

// @ts-ignore
window.fs = fs;
main();

const pre = document.getElementById('build-log')!;

async function main() {
  const bundler = new BundlerInBrowser(fs as any);

  bundler.events.on('initialized', () => log('initialized'));
  bundler.events.on('npm:progress', (e) => log(`[npm] [${e.stage}] [${e.current} / ${e.total}] ${e.packageId}`));
  bundler.events.on('npm:install:done', () => log(`[npm] install:done`));
  bundler.events.on('npm:install:error', (e) => log(`[npm] install:error`, e.errors));

  bundler.events.on('build:start', () => log('build:start'));
  bundler.events.on('build:usercode', (result) => log('build:usercode', result));
  bundler.events.on('build:vendor', (result) => log('build:vendor', result));


  await bundler.initialize({
    esbuildWasmURL: esbuildWasmURL
  });

  await installSassPlugin(bundler);
  await installVuePlugin(bundler, { enableProdDevTools: true });

  const out = await bundler.build()
    .catch((err: Error & { errors?: (PartialMessage | Error)[] }) => {
      console.error('Build error:', err.errors);
      log('❌ Build error. ' + err.message);
      err.errors?.forEach((e, i) => {
        let msg = e instanceof Error ? e.message : `${e.text}\n${e.location?.file}:${e.location?.line}:${e.location?.column}`;
        log(`(${i + 1}) ${msg}`);
      });
      throw err
    })
  log('🎉 built', out);


  // insert css
  const style = document.createElement('style');
  document.head.appendChild(style);
  style.textContent = out.css;

  // run built js
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