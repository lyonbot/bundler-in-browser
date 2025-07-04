<template>
  <component :is="Component" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { builtChunkManager } from './runtime-handler';

const Component = shallowRef(null as any);

const chunk = builtChunkManager.getChunk('user')
function updateComponent() {
  Component.value = chunk.current.exports?.default
}

updateComponent()
watch(() => chunk.current.exports, () => updateComponent())
</script>
