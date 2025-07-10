import { defineStore } from "pinia";
import { ref, shallowReactive, shallowRef } from "vue";
import { getBundlerController, type BundlerController } from "../bundler/controller";
import { EventEmitter } from "bundler-in-browser";
import { makePromise } from "yon-utils";

export const useBundlerController = defineStore('workerController', () => {
  const readyPromise = makePromise<void>()
  const isCompiling = ref<false | string>(false);
  const compilingErrors = ref<{
    file?: string;
    message?: string;
    line?: number;
    column?: number;
  }[]>([])
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

  const lastBundleOutput = shallowRef<{
    buildResult?: Awaited<ReturnType<BundlerController['api']['compile']>>
    hmrPatch?: { js: string }
  }>({})

  const compile = async () => {
    try {
      await readyPromise;
      console.log('compiling...');

      isCompiling.value = 'compiling...';

      const hmrPatch = await worker.api.tryMakeHMRPatch();  // do this before compile whole project
      const buildResult = await worker.api.compile();

      const result = lastBundleOutput.value = {
        buildResult,
        hmrPatch,
      }
      console.log('compile', result);
      return result;
    } finally {
      isCompiling.value = false;
      compilingErrors.value = await worker.api.getLastCompileErrors().catch(() => [])
    }
  }

  return {
    worker,
    isCompiling,
    readyPromise,
    compilingErrors,
    lastBundleOutput,
    compile,
  }
})
