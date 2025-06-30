import type { ConnectionEstablisher, EditorActions, RuntimeActions } from '@/preview-runtime/runtime-handler';
import type { BundlerInBrowser } from 'bundler-in-browser';
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { createWorkerDispatcher, createWorkerHandler, makePromise } from "yon-utils";
import { useBundlerController } from './bundler';

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
      runtime.sync()
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
  function sync(data?: BundlerInBrowser.BuildResult) {
    data ??= bundler.lastBundleOutput;
    if (!data) return;

    runtime.api?.updateChunk({
      name: 'vendor',
      externals: data.vendorBundle.externals,
      js: data.vendorBundle.js,
      css: data.vendorBundle.css,
    })
    runtime.api?.updateChunk({
      name: 'user',
      externals: data.userCode.externals,
      js: data.userCode.js,
      css: data.userCode.css,
    })
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
