import { defineStore } from "pinia";
import { ref, shallowReactive } from "vue";
import { useBundlerController } from "./bundler";
import { debounce } from "lodash-es";

export const useEditorStore = defineStore('editor', () => {
    const bundler = useBundlerController();
    /** files under `/`, excluding `/node_modules` */
    const files = shallowReactive<FileTreeNode[]>([])
    const syncFiles = debounce(async () => {
        if (bundler.worker.loading) await bundler.readyPromise;

        const root: FileTreeNode[] = []
        const taskQueue: [string, FileTreeNode[]][] = [['/', root]]
        while (taskQueue.length) {
            const [path, writeTo] = taskQueue.shift()!
            const items = await bundler.worker.api.readdir(path);
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
    }, 100)

    bundler.readyPromise.then(syncFiles)

    const activeFilePath = ref('')
    const openedFiles = ref<string[]>([])

    function openFile(path: string) {
        activeFilePath.value = path;
        if (!openedFiles.value.includes(path)) {
            openedFiles.value.push(path);
        }
    }

    return {
        activeFilePath,
        openedFiles,
        files,
        syncFiles,

        openFile,
    }
})

export type FileTreeNode = {
    name: string
    path: string
    children?: FileTreeNode[] // for directory
}
