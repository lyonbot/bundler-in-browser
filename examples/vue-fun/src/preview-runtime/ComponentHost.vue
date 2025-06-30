<template>
  <component :is="Component" />
</template>

<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { builtChunkManager } from './runtime-handler';

const Component = shallowRef(null as any);

watch(() => builtChunkManager.getChunk('user').revision.value, () => {
  builtChunkManager.getChunkExports('user').then(exports => {
    Component.value = exports.default
    console.log('component host: updated', Component.value)
  })
}, { immediate: true })
</script>
