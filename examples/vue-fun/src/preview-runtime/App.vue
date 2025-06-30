<template>
  <div>ready</div>
  <ComponentHost />
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import ComponentHost from './ComponentHost.vue';

onMounted(() => {
  parent.postMessage({ type: '__ready_for_connection__vue_fun__' }, '*');
})
</script>