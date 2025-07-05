<template>
  <div class="inspector-overlay" :class="{ active: hasElement }" :style="dynamicStyle">
    <div class="inspector-info" v-if="info">
      <div class="inspector-overlay-filename">{{ info.source }}</div>
      <div class="inspector-overlay-loc">{{ info.start.line }}:{{ info.start.column }}-{{ info.end.line }}:{{ info.end.column }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';

const props = defineProps<{
  element: HTMLElement | null
  info: import('../for-runtime').ParsedInspectorData | null
}>()

const hasElement = computed(() => !!props.element)
const dynamicStyle = ref<any>({})

watchEffect((onCleanup) => {
  const element = props.element

  let raf = 0;
  function nextSyncPosition() {
    if (!element) return
    raf = requestAnimationFrame(nextSyncPosition)
    const rect = element.getBoundingClientRect()
    dynamicStyle.value = {
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    }
  }

  nextSyncPosition()
  onCleanup(() => cancelAnimationFrame(raf))
})
</script>

<style lang="scss">
.inspector-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  background: #10b98166; // vue green
  outline: 2px solid #064e3bcc;
  opacity: 0;
  z-index: 10000;
  pointer-events: none;
  border-radius: 4px;
  transition: .1s ease-out;

  &.active {
    opacity: 1;
  }
}

.inspector-info {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%) translateY(4px);
  width: max-content;
  max-width: 60vw;
  font-size: 12px;
  line-height: 1;

  border-radius: 4px;
  padding: 4px 8px;
  text-align: center;
  background-color: #fff9;

  .inspector-overlay-filename {
    margin-bottom: 2px;
  }

  .inspector-overlay-loc {
    color: #6b7280;
    font-size: 10px;
  }
}
</style>
