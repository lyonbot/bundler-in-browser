<template>
  <h1>Hello Vite!</h1>
  <p>Loading: {{ worker.loading }}</p>
  <MonacoEditor v-model="code" language="vue" :options="editorOptions" />
  <pre>{{ files }}</pre>
</template>

<script setup lang="ts">
import { useBundlerController } from "./store/bundler";

const { worker, files } = useBundlerController();

import MonacoEditor from "@/monaco/MonacoEditor.vue";
import { ref, watch } from "vue";

const code = ref(`<template>
  <h1>Hello Vite!</h1>
  <p>Count is: {{ count }}</p>
  <button @click="count++">Increment</button>
</template>

<script setup>
import { ref } from 'vue'

const count = ref(0)
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

watch(
  () => worker.loading,
  async (loading) => {
    if (loading) return;

    await worker.api.writeFile("/App.vue", code.value);
    const out = await worker.api.compile()
    console.log('out', out);
  }
);
</script>
