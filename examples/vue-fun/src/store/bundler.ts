import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { getBundlerController, type BundlerController } from "../bundler/controller";
import { EventEmitter } from "bundler-in-browser";
import { makePromise } from "yon-utils";

export const useBundlerController = defineStore('workerController', () => {
  const readyPromise = makePromise<void>()
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
  }).catch(e => {
    console.error(e);
  })

  return {
    worker,
    readyPromise,
  }
})
