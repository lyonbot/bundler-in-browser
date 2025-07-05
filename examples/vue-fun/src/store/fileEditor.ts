import { defineStore } from "pinia";
import { computed, effectScope, onScopeDispose, ref, shallowReactive, watch, watchPostEffect } from "vue";
import { useBundlerController } from "./bundler";
import { debounce } from "lodash-es";
import * as monaco from "monaco-editor-core";
import { observeItems, reactiveMapOfSet } from "@/utils/reactive";
import { head } from "yon-utils";

export const useFileEditorStore = defineStore('editor', () => {
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

    const fileMarkers = reactiveMapOfSet<string, monaco.editor.IMarkerData>()
    const fileDecorations = reactiveMapOfSet<string, monaco.editor.IModelDeltaDecoration>()
    const pathToEditors = reactiveMapOfSet<string, monaco.editor.ICodeEditor>() // path -> editor

    const monacoDisposables: monaco.IDisposable[] = []
    onScopeDispose(() => monacoDisposables.forEach(f => f.dispose()))  // for vue-fun developing

    function openFile(path: string) {
        activeFilePath.value = path;
        if (!openedFiles.value.includes(path)) {
            openedFiles.value.push(path);
        }
    }

    function closeFile(path: string) {
        const index = openedFiles.value.indexOf(path);
        if (index !== -1) openedFiles.value.splice(index, 1);
        if (path === activeFilePath.value) {
            activeFilePath.value = openedFiles.value[index] || openedFiles.value[index - 1] || ''
        }
    }

    async function openFileAndGoTo(path: string, line: number, column: number, selectTo?: { line: number, column: number }) {
        openFile(path)
        const editor = await waitForEditor(path)
        if (!editor) return

        editor.revealLineInCenter(line)
        editor.focus()
        if (selectTo) {
            editor.setSelection(new monaco.Selection(line, column, selectTo.line, selectTo.column))
        } else {
            editor.setPosition({ lineNumber: line, column: column })
        }
    }

    /** wait until a editor is opened with `path` */
    function waitForEditor(path: string, timeout = 1000) {
        return new Promise<monaco.editor.ICodeEditor | null>((resolve) => {
            let retryUntil = Date.now() + timeout
            poll()
            function poll() {
                const editor = head(pathToEditors.values(path))
                if (editor) return resolve(editor);

                if (Date.now() < retryUntil) setTimeout(poll, 100);
                else resolve(null);
                return;
            }
        })
    }

    // observe all monaco editor, and auto update `pathToEditors`
    monacoDisposables.push(monaco.editor.onDidCreateEditor(editor => {
        const getCurrentPath = () => {
            let uri = editor.getModel()?.uri
            if (!uri || uri.scheme !== 'file') return null
            return uri.path
        }

        let currentPath = getCurrentPath()
        if (currentPath) pathToEditors.add(currentPath, editor)

        editor.onDidChangeModel(() => {
            const newPath = getCurrentPath()
            if (newPath === currentPath) return
            if (currentPath) pathToEditors.delete(currentPath, editor)
            if (newPath) pathToEditors.add(newPath, editor)
            currentPath = newPath
        })

        editor.onDidDispose(() => {
            if (currentPath) pathToEditors.delete(currentPath, editor)
        })
    }))

    // observe all models and apply/update markers/decorations automatically
    monacoDisposables.push(monaco.editor.onDidCreateModel(model => {
        if (model.uri.scheme !== 'file') return

        const path = model.uri.path
        const scope = effectScope()

        scope.run(() => watchPostEffect(() => {
            const markers = fileMarkers.get(path)
            monaco.editor.setModelMarkers(model, 'vue-fun', markers)
        }))

        scope.run(() => observeItems(
            computed(() => pathToEditors.get(path)),
            editor => {
                // for each editor, sync decorations
                const collection = editor.createDecorationsCollection()
                watch(() => fileDecorations.get(path), decorations => {
                    collection.set(decorations)
                }, { immediate: true })
            }
        ))

        model.onWillDispose(() => scope.stop())
    }))

    // support ctrl+click to open file
    monacoDisposables.push(monaco.editor.registerEditorOpener({
        openCodeEditor: async (source, resource, selectionOrPosition) => {
            if (resource.scheme !== 'file') return false

            const path = resource.path
            if (path.startsWith('/node_modules/')) return false
            openFile(path)

            const editor = await waitForEditor(path)
            if (!editor) return false

            if (selectionOrPosition) {
                if ('startLineNumber' in selectionOrPosition) {
                    editor.setSelection(selectionOrPosition)
                    editor.revealRangeInCenterIfOutsideViewport(selectionOrPosition)
                } else {
                    editor.setPosition(selectionOrPosition)
                    editor.revealPositionInCenterIfOutsideViewport(selectionOrPosition)
                }
            }
            editor.focus()

            return true
        }
    }))

    /**
     * get the monaco model of path (path must be in `openedFiles` already)
     * 
     * @remarks it auto disposes when file is closed
     */
    function getMonacoModelOfPath(path: string) {
        const uri = monaco.Uri.file(path)
        let existing = monaco.editor.getModel(uri);
        if (existing && !existing.isDisposed()) return existing

        if (!openedFiles.value.includes(path)) throw new Error(`path ${path} is not opened`)

        const model = monaco.editor.createModel('', undefined, uri)
        const attached = ref(false)

        // this scope will dispose along with model
        const scope = effectScope()
        model.onWillDispose(() => scope.stop())
        scope.run(() => {
            watchPostEffect(() => {
                if (!attached.value && !openedFiles.value.includes(path)) {
                    model.dispose()
                }
            })
        })

        model.onDidChangeAttached(() => {
            attached.value = model.isAttachedToEditor()
        })

        getFileContent(path).then((content) => {
            if (content === undefined) {
                updateFileContent(path, '')
                model.setValue('')
            } else {
                model.setValue(content)
            }

            model.onDidChangeContent(() => {
                updateFileContent(path, model.getValue())
            })
        })
        return model
    }

    async function getFileContent(path: string) {
        await bundler.readyPromise
        return bundler.worker.api.readFile(path)
    }

    async function updateFileContent(path: string, content: string) {
        await bundler.readyPromise;
        const { isNewFile } = await bundler.worker.api.writeFile(path, content);
        if (isNewFile) syncFiles()
    }

    return {
        activeFilePath,
        openedFiles,
        files,
        syncFiles,

        openFile,
        closeFile,
        getFileContent,
        updateFileContent,

        fileMarkers,
        fileDecorations,
        pathToEditors,
        waitForEditor,
        getMonacoModelOfPath,

        openFileAndGoTo,
    }
})

export type FileTreeNode = {
    name: string
    path: string
    children?: FileTreeNode[] // for directory
}
