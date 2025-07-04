import type { ConnectionEstablisher, EditorActions, RuntimeActions } from '@/preview-runtime/runtime-handler';
import type { BundlerInBrowser } from 'bundler-in-browser';
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { createWorkerDispatcher, createWorkerHandler, makePromise } from "yon-utils";
import { useBundlerController } from './bundler';

// this file run in editor
//
// please refer to ../preview-runtime/runtime-handler.ts for runtime side

export const useRuntimeConnection = defineStore('runtimeConnection', () => {
  const isConnected = ref(false);
  const bundler = useBundlerController()

  const exposedApi: EditorActions = {
    notifyReady: () => Promise.resolve(), // overridden by setupConnection
  }

  let lastRetryTimer: any;
  function setupConnection(postMessage: (data: any, transferable: Transferable[]) => void) {
    const readyPromise = makePromise<void>();

    const ch = new MessageChannel();  // port1 for here to write
    const connection: ConnectionEstablisher = {
      type: '__connect_vue_fun__',
      port: ch.port2,
    }

    exposedApi.notifyReady = async () => {
      exposedApi.notifyReady = () => Promise.resolve(); // prevent notifying twice
      clearTimeout(lastRetryTimer);

      runtime.api = createWorkerDispatcher<RuntimeActions>((payload, transferable) => {
        port.postMessage(payload, transferable);
      })

      isConnected.value = true;
      readyPromise.resolve();
      runtime.sync(true)
    }

    const port = ch.port1
    const handleActions = createWorkerHandler(exposedApi);
    port.onmessage = e => handleActions(e.data);
    port.start();

    function tryNext() {
      clearTimeout(lastRetryTimer);
      lastRetryTimer = setTimeout(tryNext, 500);
      postMessage(connection, [ch.port2]);
    }
    tryNext();

    return readyPromise;
  }

  /** send newest code to runtime */
  async function sync(noHMR?: boolean) {
    const { buildResult, hmrPatch } = bundler.lastBundleOutput;
    if (!buildResult) return;

    await runtime.api?.updateChunk('vendor', {
      js: buildResult.vendor.js,
      css: buildResult.vendor.css,
    })

    if (hmrPatch && !noHMR) {
      runtime.api?.applyHMR({
        js: hmrPatch.js,   // incremental js
        css: buildResult.user.css,   // whole css
      })
    } else {
      runtime.api?.updateChunk('user', {
        js: buildResult.user.js,
        css: buildResult.user.css,
      })
      // runtime.api?.freeHMRMemory()  // TODO
    }

  }

  watch(() => bundler.lastBundleOutput, () => sync())

  const runtime = {
    api: null as RuntimeActions | null,
    sync,
  }
  return {
    isConnected,
    setupConnection,
    runtime,
  }
})
