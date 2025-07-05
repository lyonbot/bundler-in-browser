<template>
  <div class="flex h-screen">
    <div class="flex-0 flex flex-col overflow-auto" style="flex-basis: 220px">
      <FileTree />
    </div>
    <div class="flex-1 flex flex-col relative contain-size">
      <Editors />
    </div>
    <div class="flex-1">
      <Preview />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useBundlerController } from "./store/bundler";

const { worker, readyPromise, compile } = useBundlerController();
const editorStore = useFileEditorStore();

import { ref } from "vue";
import FileTree from "./components/FileTree";
import { useFileEditorStore } from "./store/fileEditor";
import Editors from "./components/Editors.vue";
import Preview from "./components/Preview.vue";
import { useEventListener } from "@vueuse/core";
import { modKey } from "yon-utils";

readyPromise.then(async () => {
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
</script>
