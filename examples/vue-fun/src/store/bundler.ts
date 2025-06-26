import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { getBundlerController, type BundlerController } from "../bundler/controller";

export const useBundlerController = defineStore('workerController', () => {
  const worker = shallowReactive<BundlerController & { loading?: boolean }>({
    api: null as any,
    worker: null as any,
    logs: [],
    clearLogs() { this.logs.length = 0 },
    loading: true,
  });

  getBundlerController().then(c => {
    c.logs.push(...worker.logs);
    Object.assign(worker, c);
    worker.loading = false;
  }).catch(e => {
    console.error(e);
  })

  return {
    worker,
  }
})
