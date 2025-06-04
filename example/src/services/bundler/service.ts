// eslint-disable default
import { atom, createStore } from "jotai";
import CompilerWorker from "./bundler.worker?worker";
import {
  isNPMProgressMessage,
  isWorkerLogMessage,
  isWorkerReadyMessage,
  workerSourceMarker,
  type BuildRequest,
  type BuildResponse,
  type BuildSuccessResponse,
  type WorkerLogMessage,
} from "./common";
import { makePromise } from "yon-utils";
import { MiniNPM } from "bundler-in-browser";

/**
 * Service class handling compilation operations using Web Workers
 * Manages the compilation process and maintains the worker's state
 */
export class BundlerService {
  /** Web Worker instance for handling compilation tasks */
  private worker?: Worker;
  private workerLoadingPromise?: Promise<void>;

  /** Jotai store instance for state management */
  store = createStore();

  isReadyAtom = atom(false);
  isBuildingAtom = atom(false);
  npmInstallProgressAtom = atom<MiniNPM.ProgressEvent | null>(null); // only while npm installing
  logsAtom = atom<WorkerLogMessage[]>([]);
  resultAtom = atom<BuildSuccessResponse | null>(null); // last successful compilation result
  errorsAtom = atom<any[]>([]); // last compilation errors

  /**
   * Initializes the BundlerService and sets up the worker
   */
  constructor() {
    this.resetWorker(); // initialize the worker for the first time
  }

  /**
   * Resets the worker instance and initializes a new one
   * @returns Promise that resolves when the worker is ready
   */
  async resetWorker() {
    this.worker?.terminate();
    this.worker = undefined;

    const worker = new CompilerWorker();

    this.store.set(this.isReadyAtom, false);
    this.store.set(this.isBuildingAtom, false);
    this.worker = worker;

    const promise = makePromise<void>();
    worker.addEventListener("message", (e) => {
      if (isWorkerReadyMessage(e.data)) {
        const error = e.data.error;
        if (!error) promise.resolve();
        else {
          promise.reject(error);
          if (this.worker === worker) this.worker = undefined;
          this.store.set(this.isReadyAtom, false);
          worker.terminate();
        }
        return;
      }

      if (isWorkerLogMessage(e.data)) {
        this.store.set(
          this.logsAtom,
          this.store.get(this.logsAtom).concat(e.data).slice(-500)
        );
        return;
      }

      if (isNPMProgressMessage(e.data)) {
        this.store.set(this.npmInstallProgressAtom, e.data.progress);
      }
    });

    this.workerLoadingPromise = promise;
    await promise;

    if (worker === this.worker) this.store.set(this.isReadyAtom, true);
  }

  clearLogs() {
    this.store.set(this.logsAtom, []);
  }

  /**
   * Compiles the provided source files using the worker
   * @param {Object} files - Key-value pairs of file paths and their contents
   * @param {string} files[path] - Content of the file at the specified path
   */
  async build(files: { [path: string]: string }) {
    const { port1, port2 } = new MessageChannel();
    const message: BuildRequest = {
      type: 'build',
      target: workerSourceMarker,
      files,
      port: port2,
    };

    if (!this.worker) await this.resetWorker();
    await this.workerLoadingPromise;

    // prevent multiple compilations
    if (this.store.get(this.isBuildingAtom)) return;

    this.store.set(this.isBuildingAtom, true);
    this.worker!.postMessage(message, [port2]);

    const data = await new Promise<BuildResponse>((resolve) => {
      port1.onmessage = (e: MessageEvent<BuildResponse>) => {
        resolve(e.data);
      };
    });

    this.store.set(this.isBuildingAtom, false);
    if ("result" in data) {
      this.store.set(this.resultAtom, data);
      this.store.set(this.errorsAtom, []);
    } else {
      this.store.set(this.errorsAtom, data.errors);
    }
  }
}
