<template>
  <div class="flex h-screen">
    <div class="flex-0 flex flex-col overflow-auto" style="flex-basis: 300px">
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

const code = ref(`<template>
  <h1>{{ message }}</h1>
  <p>Count is: {{ count }}</p>
  <button class="bg-blue-500 text-white rounded" @click="count++">Increment</button>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import confetti from "canvas-confetti"
import { hi } from './utils'

defineProps<{
}>()

const message = hi()
const count = ref(0)

onMounted(() => {
  confetti() // 🎊 tada!
})
</${"script>"}


<style>
.text-red {
  color: red;  
}
</style>
`);

const editorOptions = {
  fontSize: 14,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
};

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
  
  await worker.api.writeFile("/src/utils.ts", `export const hi = ()=>'hi' as const`);
  await worker.api.writeFile("/src/Main.vue", code.value);
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
