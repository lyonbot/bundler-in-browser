import { defineStore } from "pinia";
import { shallowReactive } from "vue";
import { getBundlerController, type BundlerController } from "../bundler/controller";
import { debouncePromise } from "yon-utils";

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
    syncFiles()
  }).catch(e => {
    console.error(e);
  })

  /** files under `/`, excluding `/node_modules` */
  const files = shallowReactive<FileTreeNode[]>([])
  const syncFiles = debouncePromise(async () => {
    if (worker.loading) return

    const root: FileTreeNode[] = []
    const taskQueue: [string, FileTreeNode[]][] = [['/', root]]
    while (taskQueue.length) {
      const [path, writeTo] = taskQueue.shift()!
      const items = await worker.api.readdir(path);
      for (const item of items) {
        if (item.path === '/node_modules') continue;

        const node: FileTreeNode = {
          name: item.name,
          path: item.path,
        }
        writeTo.push(node);
        if (item.isDirectory) taskQueue.push([item.path, node.children = []]);
      }
    }

    files.splice(0, files.length, ...root)
  })

  return {
    worker,
    files,
    syncFiles,
  }
})

type FileTreeNode = {
  name: string
  path: string
  children?: FileTreeNode[] // for directory
}
