import esbuild, { type InitializeOptions } from 'esbuild-wasm'
import injectedCode from './esbuild-worker-patch.js?built'
import { handleCommand } from './rpc-port.js';

export type EsbuildProxy = typeof import('esbuild-wasm')

export async function createEsbuildWorker(opt: {
  fs: any;
  initOptions: Omit<InitializeOptions, 'worker'>,
}) {
  const { fs } = opt
  const pendingWorkers: Worker[] = []

  // monkey-patch the Blob and Worker constructor, so we can inject some code to proxy fs.
  // (i thought about forking esbuild-wasm, but it take more efforts to maintain, which not worth it)
  const { Blob, Worker } = self;
  self.Blob = class PatchedBlob extends Blob {
    constructor(sources?: BlobPart[], ...args: any[]) {
      if ((Array.isArray(sources) && sources.length === 1 && typeof sources[0] === 'string')) {
        let originalCode = sources[0]
        let index = originalCode.indexOf(';', originalCode.indexOf('--service=') + 1)

        sources = [
          injectedCode.replace('__FS_CONSTANTS__', JSON.stringify(fs.constants)),
          originalCode.slice(0, index + 1),
          'self.__patchFs__(fs);',
          originalCode.slice(index + 1),
        ]
      }
      super(sources, ...args)
    }
  }
  self.Worker = class PatchedWorker extends Worker {
    _onmessage!: ((ev: MessageEvent) => void) | null

    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args)
      pendingWorkers.push(this);
      this.addEventListener('message', function (ev) {
        if (ev.data?.type === '__fs__') {
          const { method, payload } = ev.data;
          const fn = (...args: any[]) => new Promise((resolve) => {
            const callback = (...cbArgs: any[]) => {
              const v = cbArgs[1]
              console.log('callback', method, args, '==>', cbArgs)

              // bug: @zenfs/core use getter, which not copied by the serializer
              if (method.endsWith('stat') && v) cbArgs[1] = {
                ...v,
                blocks: v.blocks,
              }

              resolve(cbArgs);
            }
            fs[method](...args, callback);
          })
          handleCommand(fn, payload)
        } else {
          (this as any)._onmessage?.(ev)
        }
      });
    }

    get onmessage() {
      return this._onmessage
    }
    set onmessage(fn) {
      this._onmessage = fn
    }
  }

  // start esbuild
  await esbuild.initialize({
    ...opt.initOptions,
    worker: true, // forced!
  })

  // revert patches
  self.Blob = Blob
  self.Worker = Worker

  const worker = pendingWorkers[0];
  if (!worker) throw new Error('worker not caught. do not initialize esbuild-wasm before bundler-in-browser');

  return { esbuild, worker }
}
