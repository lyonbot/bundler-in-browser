<template>
  <div class="flex h-screen">
    <div class="flex-0 flex flex-col overflow-auto" :style="{ flexBasis: `${fileListWidth}px` }">
      <FileTree />
    </div>
    <div class="w-1 touch-none hover:bg-gray-2 cursor-ew-resize" @pointerdown="startResizeFileList"></div>

    <div class="flex-1 min-w-0 flex flex-col relative contain-size" :style="{ flexGrow: editorWidthFactor }">
      <Editors />
    </div>
    <div class="w-1 touch-none hover:bg-gray-2 cursor-ew-resize" @pointerdown="startResizeEditor"></div>

    <div class="flex-1 min-w-0 z-100" :style="{ flexGrow: 1 - editorWidthFactor }"> <!-- z-100 for monaco overlay bug -->
      <Preview />
    </div>
  </div>

  <div v-if="loading"
    class="fixed left-50% top-50% translate-x-[-50%] translate-y-[-50%] flex flex-col items-center justify-center">
    <Loading />
    <div class="mt-4 text-xl">Loading Bundler and Environment...</div>
  </div>
</template>

<script setup lang="ts">
import { useBundlerController } from "./store/bundler";

const { worker, readyPromise, compile } = useBundlerController();
const editorStore = useFileEditorStore();

import { useEventListener, useLocalStorage } from "@vueuse/core";
import { ref } from "vue";
import { modKey } from "yon-utils";
import Editors from "./components/Editors.vue";
import FileTree from "./components/FileTree";
import Preview from "./components/Preview.vue";
import { useFileEditorStore } from "./store/fileEditor";
import { Loading } from "tdesign-vue-next";
import { createResizeHandler } from "./utils/resizing";

const loading = ref(true);

readyPromise.then(async () => {
  loading.value = false;
  await worker.api.writeFile('/src/index.js', `
    import "./styles.css";
    import Main from './Main.vue'
    export default Main
    `.replace(/^\s+/gm, ''));

  await worker.api.writeFile("/src/styles.css", `
    @tailwind base;
    @tailwind components;
    @tailwind utilities;
    `.replace(/^\s+/gm, ''));

  const sampleFiles = import.meta.glob('./sample-project/**/*', { import: 'default', query: 'raw' })
  for (const [file, loader] of Object.entries(sampleFiles)) {
    const source = await loader() as string
    const path = `/src/${file.slice('./sample-project/'.length)}`
    await worker.api.writeFile(path, source)
  }

  editorStore.openFile('/src/Main.vue')

  compile();
});

useEventListener(window, 'keydown', e => {
  if (modKey(e) === modKey.Mod && e.code === 'KeyS') {
    compile();
    e.preventDefault();
  }
})

// ----------------------------------------------
const fileListWidth = useLocalStorage('file-list-width', 220)
const editorWidthFactor = useLocalStorage('editor-width-factor', 0.5)
const startResizeFileList = createResizeHandler([
  { axis: 'x', ref: fileListWidth, min: 100, max: 500 },
])
const startResizeEditor = createResizeHandler([
  {
    axis: 'x',
    ref: editorWidthFactor,
    min: 0.1,
    max: 0.9,
    scale: () => 1 / (window.innerWidth - fileListWidth.value),
  },
])
</script>
