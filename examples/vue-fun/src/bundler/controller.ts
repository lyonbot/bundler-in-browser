import { createWorkerDispatcher } from "yon-utils";
import { shallowReactive, type ShallowReactive } from "vue";
import type { VueFunWorkerMethods } from "./worker";
import { EventEmitter } from "bundler-in-browser";

type Events = {
  'file-modified': (path: string) => void
}

export type BundlerController = {
  worker: Worker;
  api: VueFunWorkerMethods;
  logs: ShallowReactive<Array<WorkerLogItem>>;
  events: EventEmitter<Events>
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

    const events = new EventEmitter<Events>()
    const logs = shallowReactive([] as Array<WorkerLogItem>);
    worker.onmessage = (e) => {
      const data = e.data, type = data?.type
      if (!data) return

      if (type === 'worker-log') {
        logs.push({
          time: Date.now(),
          message: data.message,
          data: data.data,
        })
      } else if (type === 'worker-file-modified') {
        events.emit('file-modified', data.path)
      }
    }
    worker.onerror = (e) => reject(new Error(e.message));
    api.init().then(() => resolve({
      worker,
      api,
      logs,
      events,
      clearLogs: () => { logs.length = 0 }
    }));
  });
  return workerPromise;
}
