import { defineStore } from "pinia";
import { ref, shallowReactive, shallowRef } from "vue";
import { getBundlerController, type BundlerController } from "../bundler/controller";
import { BundlerInBrowser, EventEmitter } from "bundler-in-browser";
import { makePromise } from "yon-utils";

export const useBundlerController = defineStore('workerController', () => {
  const readyPromise = makePromise<void>()
  const isCompiling = ref<false | string>(false);
  const worker = shallowReactive<BundlerController & { loading?: boolean }>({
    api: null as any,
    worker: null as any,
    logs: [],
    events: new EventEmitter(),
    clearLogs() { this.logs.length = 0 },
    loading: true,
  });

  getBundlerController().then(c => {
    c.logs.push(...worker.logs);
    Object.assign(worker, c);
    worker.loading = false;
    readyPromise.resolve()
    worker.events.on('compiling-progress', message => isCompiling.value = message)
  }).catch(e => {
    console.error(e);
  })

  const lastBundleOutput = shallowRef<BundlerInBrowser.BuildResult | undefined>(undefined);
  const compile = async () => {
    try {
      isCompiling.value = 'compiling...';

      const result = await worker.api.compile();

      lastBundleOutput.value = result;
      console.log('compile', result);
      return result;
    } finally {
      isCompiling.value = false;
    }
  }

  return {
    worker,
    isCompiling,
    readyPromise,
    lastBundleOutput,
    compile,
  }
})
