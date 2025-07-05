<template>
  <div class="app">
    <div class="componentArea">
      <ComponentHost />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ComponentHost from './ComponentHost.vue';

onMounted(() => {
  parent.postMessage({ type: '__ready_for_connection__vue_fun__' }, '*');
})
</script>

<style scoped>
body {
  background-color: #f0f0f0;
}

.app {
  margin: 8px;
  padding: 16px;
  border: 1px solid #ccc;
  border-radius: 16px;
}
</style>