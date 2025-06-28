///<reference lib="webworker" />

// this run in worker thread

import { createWorkerHandler } from "yon-utils"
import { BundlerInBrowser, installSassPlugin, installVuePlugin } from "bundler-in-browser";
import installTailwindPlugin from "@bundler-in-browser/tailwindcss";
import { fs } from "@zenfs/core";
import { vueInspectorNodeTransform } from "./vueNodeTransform";
import { dirname, join } from "@zenfs/core/path.js";

const bundler = new BundlerInBrowser(fs as any);

async function init() {
  await bundler.initialize({})

  bundler.config.externals.push('vue')

  await installTailwindPlugin(bundler, {
    rootDir: "/src",
    tailwindConfig: {
      corePlugins: {
        // preflight: false, // disable Tailwind's reset
      },
    },
  });
  await installSassPlugin(bundler);
  await installVuePlugin(bundler, {
    enableProdDevTools: true,
    templateCompilerOptions: {
      // Cool Part
      nodeTransforms: [
        vueInspectorNodeTransform,
      ]
    }
  });

  log('init done');

  await writeFile('/src/index.js', `
    import { createApp } from 'vue'
    import App from './App.vue'

    createApp(App).mount('#root')
    `);
}

async function compile() {
  const out = await bundler.build()
  return out
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
