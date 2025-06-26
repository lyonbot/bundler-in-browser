///<reference lib="webworker" />

// this run in worker thread

import { createWorkerHandler } from "yon-utils"
import { BundlerInBrowser, installSassPlugin, installVuePlugin, type VuePluginInstance } from "bundler-in-browser";
import installTailwindPlugin from "@bundler-in-browser/tailwindcss";
import { fs } from "@zenfs/core";
import { vueInspectorNodeTransform } from "./vueNodeTransform";

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

  await writeFile('/index.js', `
    import { createApp } from 'vue'
    import App from './App.vue'

    createApp(App).mount('#root')
    `);
}

async function writeFile(path: string, content: string) {
  await fs.promises.writeFile(path, content);
}

async function compile() {
  const out = await bundler.build()
  return out
}

const methods = {
  init,
  writeFile,
  compile,
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
