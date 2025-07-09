import { proxyRefs, ref } from "vue"
import { useBundlerController } from "./bundler"
import { useFileEditorStore } from "./fileEditor"
import { useLocalStorage } from "@vueuse/core"
import { isEmpty } from "lodash-es"

const getWorkerAPI = () => useBundlerController().worker.api
const openFile = (path: string) => useFileEditorStore().openFile(path)
const persistData = useLocalStorage('vue-fun-persist-files', {} as Record<string, string>)

async function loadProject() {
  const api = getWorkerAPI()
  await api.rm('/src')

  // FIXME: this is a hack
  useFileEditorStore().openedFiles.length = 0
  useFileEditorStore().activeFilePath = ''

  if (isEmpty(persistData.value)) {
    await loadSampleFiles()
  } else {
    for (const [path, content] of Object.entries(persistData.value)) {
      await api.writeFile(path, content)
    }
  }

  if (await api.stat('/src/Main.vue')) {
    openFile('/src/Main.vue')
  }
}

async function loadSampleFiles() {
  const api = getWorkerAPI()
  await api.writeFile('/src/index.js', `
    import "./styles.css";
    import Main from './Main.vue'
    export default Main
    `.replace(/^\s+/gm, ''));

  await api.writeFile("/src/styles.css", `
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
    `.replace(/^\s+/gm, ''));

  const sampleFiles = import.meta.glob('../sample-project/**/*', { import: 'default', query: 'raw' })
  for (const [file, loader] of Object.entries(sampleFiles)) {
    const source = await loader() as string
    const path = `/src/${file.slice('../sample-project/'.length)}`
    await api.writeFile(path, source)
  }
}

async function storeProject() {
  const api = getWorkerAPI()
  const out = {} as Record<string, string>
  for (const ent of await api.readdir('/src', { recursive: true })) {
    if (ent.isDirectory) continue
    const content = await api.readFile(ent.path)
    if (content) out[ent.path] = content
  }
  persistData.value = out
}

async function resetProject() {
  persistData.value = {}
  await loadProject()
}

const persistStore = proxyRefs({
  loadProject,
  storeProject,
  resetProject,
})

export const usePersistStore = () => persistStore
