import { atom, createStore } from "jotai";
import CompilerWorker from "./compiler.worker?worker";
import {
  isNPMProgressMessage,
  isWorkerLogMessage,
  isWorkerReadyMessage,
  workerSourceMarker,
  type CompilationRequest,
  type CompilationResponse,
  type CompilationSuccessResponse,
  type WorkerLogMessage,
} from "./common";
import { makePromise } from "yon-utils";
import { BundlerInBrowser, MiniNPM } from "bundler-in-browser";

/**
 * Service class handling compilation operations using Web Workers
 * Manages the compilation process and maintains the worker's state
 */
export class CompilerService {
  /** Web Worker instance for handling compilation tasks */
  private worker?: Worker;
  private workerLoadingPromise?: Promise<void>;

  /** Jotai store instance for state management */
  store = createStore();

  isReadyAtom = atom(false);
  isCompilingAtom = atom(false);
  npmInstallProgressAtom = atom<MiniNPM.ProgressEvent | null>(null); // only while npm installing
  logsAtom = atom<WorkerLogMessage[]>([]);
  resultAtom = atom<CompilationSuccessResponse | null>(null); // last successful compilation result
  errorsAtom = atom<any[]>([]); // last compilation errors

  /**
   * Initializes the CompilerService and sets up the worker
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
    this.store.set(this.isCompilingAtom, false);
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
  async compile(files: { [path: string]: string }) {
    const { port1, port2 } = new MessageChannel();
    const message: CompilationRequest = {
      type: "compile",
      target: workerSourceMarker,
      files,
      port: port2,
    };

    if (!this.worker) await this.resetWorker();
    await this.workerLoadingPromise;

    // prevent multiple compilations
    if (this.store.get(this.isCompilingAtom)) return;

    this.store.set(this.isCompilingAtom, true);
    this.worker!.postMessage(message, [port2]);

    const data = await new Promise<CompilationResponse>((resolve) => {
      port1.onmessage = (e: MessageEvent<CompilationResponse>) => {
        resolve(e.data);
      };
    });

    this.store.set(this.isCompilingAtom, false);
    if ("result" in data) {
      this.store.set(this.resultAtom, data);
      this.store.set(this.errorsAtom, []);
    } else {
      this.store.set(this.errorsAtom, data.errors);
    }
  }
}
