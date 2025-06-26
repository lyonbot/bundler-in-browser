import { createWorkerDispatcher } from "yon-utils";
import { shallowReactive, type ShallowReactive } from "vue";
import type { VueFunWorkerMethods } from "./worker";

export type BundlerController = {
  worker: Worker;
  api: VueFunWorkerMethods;
  logs: ShallowReactive<Array<WorkerLogItem>>;
  clearLogs: () => void;
};

// this run in main thread

let workerPromise: Promise<BundlerController>;

export interface WorkerLogItem {
  time: number;
  message: string;
  data?: any[]
}

export const getBundlerController = () => {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const api = createWorkerDispatcher<VueFunWorkerMethods>((payload, transferable) => {
      worker.postMessage({ type: 'worker-command', payload }, transferable);
    });

    const logs = shallowReactive([] as Array<WorkerLogItem>);
    worker.onmessage = (e) => {
      if (e.data?.type === 'worker-log') {
        logs.push({
          time: Date.now(),
          message: e.data.message,
          data: e.data.data,
        })
      }
    }
    worker.onerror = (e) => reject(new Error(e.message));
    api.init().then(() => resolve({
      worker,
      api,
      logs,
      clearLogs: () => { logs.length = 0 }
    }));
  });
  return workerPromise;
}
