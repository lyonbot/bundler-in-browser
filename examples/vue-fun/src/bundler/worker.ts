///<reference lib="webworker" />
//
// this run in worker thread
// the worker is created by ./controller.ts
//

import { createWorkerHandler } from "yon-utils"
import { BundlerInBrowser, installSassPlugin, installVuePlugin, type VuePluginInstance } from "bundler-in-browser";
import installTailwindPlugin from "@bundler-in-browser/tailwindcss";
import { fs } from "@zenfs/core";
import * as shabbyVueHMR from '../abilities/shabby-vue-hmr/bundler-side.js'
import { dirname, join } from "@zenfs/core/path.js";
import { throttle } from "lodash-es";

const bundler = new BundlerInBrowser(fs as any);

async function init() {
  await bundler.initialize({})

  bundler.events.on('npm:progress', ev => sendCompileProgress(`npm: ${ev.stage} (${ev.current}/${ev.total})`))
  bundler.events.on('npm:install:done', () => sendCompileProgress(`npm: install done`))
  bundler.events.on('npm:install:error', (errors) => {
    console.error(`npm install error!`, errors)
    sendCompileProgress(`npm: install error! ${errors}`)
  })
  bundler.events.on('build:start', () => sendCompileProgress(`build: start`))
  bundler.events.on('build:usercode', () => sendCompileProgress(`build: usercode done`))
  bundler.events.on('build:vendor', () => sendCompileProgress(`build: vendor done`))

  bundler.config.externals.push('vue')

  await installTailwindPlugin(bundler, {
    rootDir: "/src",
    pattern: /\.(css|scss|html|vue|jsx?|tsx?|md)$/,   // defaults
    tailwindConfig: {
      corePlugins: {
        preflight: false, // disable Tailwind's reset
      },
    },
  });
  await installSassPlugin(bundler);
  vuePluginInstance = await installVuePlugin(bundler, {
    enableProdDevTools: true,
    templateCompilerOptions: {},
  });

  setProdMode(false)
  log('init done');
}

let isProd = false
let vuePluginInstance!: VuePluginInstance

async function setProdMode(_isProd: boolean) {
  isProd = _isProd;
  shabbyVueHMR.setEnableVueHMR(vuePluginInstance, !isProd)
}

const sendCompileProgress = throttle((message: string) => postMessage({ type: 'worker-compiling-progress', message }), 100)
async function compile() {
  try {
    resetModifiedList()
    const out = await bundler.build()
    return {
      user: { js: out.userCode.js, css: out.userCode.css },
      vendor: { js: out.vendorBundle.js, css: out.vendorBundle.css },
    }
  } finally {
    sendCompileProgress.cancel()
  }
}

/**
 * try to make a HMR patch for the modified files.
 * 
 * 🖖 for now only support .vue files.
 * 
 * if success, will return a chunk, otherwise return undefined.
 * 
 * also, please do a completed compile after this, so you can get the new `css` for your project,
 * and the next HMR patch can be generated correctly.
 */
async function tryMakeHMRPatch() {
  // FIXME: bundler-in-browser shall support HMR, so this function will be removed

  if (isProd) return;

  const changedPath = [...modifiedFiles.keys()]
  const result = await shabbyVueHMR.tryBuildHMRPatch(vuePluginInstance, changedPath)
  return result
}

// #region file access

async function readdir(path: string, opt?: { recursive?: boolean }) {
  const result: Array<{
    name: string,
    path: string,
    isDirectory: boolean,
    isSymbolicLink: boolean,
  }> = []

  const recursive = !!opt?.recursive
  const scanQueue = [path]
  while (scanQueue.length) {
    const iDir = scanQueue.shift()!
    const files = await fs.promises.readdir(iDir, { withFileTypes: true });
    for (const file of files) {
      const iFullPath = join(iDir, file.name)
      if (recursive && file.isDirectory()) scanQueue.push(iFullPath)
      result.push({
        name: file.name,
        path: iFullPath,
        isDirectory: file.isDirectory(),
        isSymbolicLink: file.isSymbolicLink(),
      })
    }
  }

  return result
}

async function readFile(path: string): Promise<string | undefined>
async function readFile(path: string, asUint8Array: true): Promise<Uint8Array | undefined>
async function readFile(path: string, asUint8Array?: boolean): Promise<string | Uint8Array | undefined>
async function readFile(path: string, asUint8Array?: boolean) {
  return await fs.promises.readFile(path, asUint8Array ? undefined : 'utf8').catch(() => undefined) as any
}

async function stat(path: string) {
  const res = await fs.promises.lstat(path).catch(() => undefined)
  if (!res) return null
  return {
    ctime: res.ctimeMs,
    mtime: res.mtimeMs,
    size: res.size,
    isDirectory: res.isDirectory(),
    isSymbolicLink: res.isSymbolicLink(),
  }
}

async function writeFile(path: string, content: string | Uint8Array) {
  const dir = dirname(path)
  await fs.promises.mkdir(dir, { recursive: true })

  await markFileAsModified(path)
  await fs.promises.writeFile(path, content);
}

async function rm(path: string) {
  // recursive scan for "markFileAsModified"

  const s = await fs.promises.stat(path).catch(() => undefined)
  if (!s) return

  if (s.isDirectory()) {
    const contents = await readdir(path, { recursive: true })
    for (const item of contents) {
      if (!item.isDirectory) await markFileAsModified(item.path)
    }
  } else {
    await markFileAsModified(path)
  }

  // now actual delete
  await fs.promises.rm(path, { recursive: true, force: true })
}

const modifiedFiles = new Map<string, { content: Uint8Array | undefined, sinceTime: number }>()
const markFileAsModified = async (path: string) => {
  if (!modifiedFiles.has(path)) {
    modifiedFiles.set(path, { content: await readFile(path, true), sinceTime: Date.now() })
    postMessage({ type: 'worker-file-modified', path })
  }
}
const getModifiedList = async () => {
  const items: string[] = []
  for (const [path, { content }] of modifiedFiles) {
    const currentContent = await readFile(path, true)
    if (!currentContent && !content) continue // both deleted
    if (currentContent?.length === content?.length && content && content.every((v, i) => v === currentContent![i])) continue // same content
    items.push(path)
  }
  return items
}
const resetModifiedList = async () => {
  modifiedFiles.clear()
}

// #endregion

const methods = {
  init,
  compile,
  tryMakeHMRPatch,

  // fs
  readdir,
  readFile,
  writeFile,
  stat,
  rm,

  // fs: modified
  getModifiedList,
  resetModifiedList,
}

export type VueFunWorkerMethods = typeof methods

const handler = createWorkerHandler(methods);
self.addEventListener('message', e => {
  if (e.data?.type === 'worker-command') handler(e.data.payload);
});
self.postMessage({ type: 'worker-ready' });
function log(message: string, ...data: any[]) {
  console.log('worker|', message, ...data);
  self.postMessage({ type: 'worker-log', message, data });
}
