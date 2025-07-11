import type { ConnectionEstablisher, EditorActions, RuntimeActions } from '@/preview-runtime/runtime-handler';
import * as monaco from 'monaco-editor-core';
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { createWorkerDispatcher, createWorkerHandler, makePromise, MOD_KEY } from "yon-utils";
import { useBundlerController } from './bundler';
import { useFileEditorStore } from './fileEditor';
import type { InspectorEditorApi, InspectorRuntimeApi } from '@/abilities/vue-inspector/constants';

// this file run in editor
//
// please refer to ../preview-runtime/runtime-handler.ts for runtime side

export const useRuntimeConnection = defineStore('runtimeConnection', () => {
  const isConnected = ref(false);
  const errorMessages = ref<{ message: string; file: string }[]>([])
  const bundler = useBundlerController()
  const editorStore = useFileEditorStore()

  const editorApiForRuntime: EditorActions = {
    notifyReady: () => Promise.resolve(), // overridden by setupConnection

    async openFileAndGoTo(path, positionOrRange) {
      editorStore.openFileAndGoTo(path, positionOrRange)
    },

    async addRuntimeError(err) {
      errorMessages.value.push(err)
    },

    async onModPPressed() {
      //FIXME: decouple from ../components/Preview.vue
      const ev = new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        [MOD_KEY]: true,
      })
      window.dispatchEvent(ev)
    },
  }

  const editorApiForInspector: InspectorEditorApi = {
    async setHoveringNode(data) {
      if (currentHovering) editorStore.fileDecorations.delete(currentHovering.filePath, currentHovering.decoration)
      if (!data) return currentHovering = undefined
      currentHovering = {
        filePath: data.loc.source,
        decoration: {
          options: {
            className: 'monaco-inspectorHoveringDecorator'
          },
          range: new monaco.Range(
            data.loc.start.line,
            data.loc.start.column,
            data.loc.end.line,
            data.loc.end.column,
          ),
        },
      }
      editorStore.fileDecorations.add(currentHovering.filePath, currentHovering.decoration)
    },
  }

  let currentHovering: { filePath: string, decoration: monaco.editor.IModelDeltaDecoration } | undefined

  let runtimeApiPort: MessagePort | undefined
  const runtimeApi = createWorkerDispatcher<RuntimeActions>((payload, transferable) => {
    runtimeApiPort?.postMessage(payload, transferable);
  });

  let inspectorApiPort: MessagePort | undefined
  const inspectorApi = createWorkerDispatcher<InspectorRuntimeApi>((payload, transferable) => {
    inspectorApiPort?.postMessage(payload, transferable);
  });

  let lastRetryTimer: any;
  function setupConnection(postMessage: (data: any, transferable: Transferable[]) => void) {
    const readyPromise = makePromise<void>();

    const chRuntime = new MessageChannel();  // port1 for here to write
    const chInspector = new MessageChannel(); // port1 for here to write

    const connection: ConnectionEstablisher = {
      type: '__connect_vue_fun__',
      port: chRuntime.port2,
      portForInspector: chInspector.port2,
    }

    editorApiForRuntime.notifyReady = async () => {
      editorApiForRuntime.notifyReady = () => Promise.resolve(); // prevent notifying twice
      clearTimeout(lastRetryTimer);

      runtimeApiPort = newRuntimePort
      inspectorApiPort = newInspectorPort

      isConnected.value = true;
      readyPromise.resolve();
      sync(true)
    }

    const newRuntimePort = chRuntime.port1
    const handleRuntimeActions = createWorkerHandler(editorApiForRuntime);
    newRuntimePort.onmessage = e => handleRuntimeActions(e.data);
    newRuntimePort.start();

    const newInspectorPort = chInspector.port1
    const handleInspectorActions = createWorkerHandler(editorApiForInspector);
    newInspectorPort.onmessage = e => handleInspectorActions(e.data);
    newInspectorPort.start();

    function tryNext() {
      clearTimeout(lastRetryTimer);
      lastRetryTimer = setTimeout(tryNext, 500);
      postMessage(connection, [chRuntime.port2, chInspector.port2]);
    }
    tryNext();

    return readyPromise;
  }

  /** send newest code to runtime */
  async function sync(noHMR?: boolean) {
    const { buildResult, hmrPatch } = bundler.lastBundleOutput;
    if (!buildResult) return;

    errorMessages.value.length = 0

    await runtimeApi.updateChunk('vendor', {
      js: buildResult.vendor.js,
      css: buildResult.vendor.css,
    })

    if (hmrPatch && !noHMR) {
      runtimeApi.applyHMR({
        js: hmrPatch.js,   // incremental js
        css: buildResult.user.css,   // whole css
      })
    } else {
      runtimeApi.updateChunk('user', {
        js: buildResult.user.js,
        css: buildResult.user.css,
      })
      // runtime.api?.freeHMRMemory()  // TODO
    }
  }

  watch(() => bundler.lastBundleOutput, () => sync())


  return {
    isConnected,
    setupConnection,
    sync,
    errorMessages,
    runtimeApi,
    inspectorApi,
  }
})
