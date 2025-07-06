<!-- a component to display the popup menu with nodes picked by clicking -->

<script setup lang="ts">
import type { InspectorRuntimeApi } from '@/abilities/vue-inspector/constants';
import { useFileEditorStore } from '@/store/fileEditor';
import * as monaco from 'monaco-editor-core';
import { computed, ref, watchPostEffect } from 'vue';
import { createPopper } from '@popperjs/core';
import { useEventListener } from '@vueuse/core';

const editorStore = useFileEditorStore()

const { nodes } = defineProps<{
  nodes: InspectorRuntimeApi.PickResultNode[]
}>()

const emits = defineEmits<{
  (e: 'close'): void
}>()

const canDisplay = computed(() => nodes.length > 0)
const wrapperRef = ref<HTMLDivElement>()
const anchorRef = ref<HTMLDivElement>()

useEventListener(
  () => canDisplay.value ? window : null,
  'keydown',
  (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      emits('close')
      e.preventDefault()
      e.stopPropagation()
    }
  },
  true
)

watchPostEffect((onCleanUp) => {
  if (!canDisplay.value) return

  const wrapper = wrapperRef.value
  const anchor = anchorRef.value
  if (!wrapper || !anchor) return

  const rect = nodes[0].rect
  const popper = createPopper(
    {
      getBoundingClientRect: () => {
        const anchorRect = anchor.getBoundingClientRect()
        return new DOMRect(rect.left + anchorRect.left, rect.top + anchorRect.top, rect.width, rect.height)
      },
    },
    wrapper,
    {
      placement: 'bottom-start',
      modifiers: [
        {
          name: 'offset',
          options: {
            offset: [0, 8],
          },
        },
      ],
    }
  )
  onCleanUp(() => popper.destroy())
})

function handleItemMouseEnter(e: MouseEvent, data: InspectorRuntimeApi.PickResultNode) {
  const path = data.loc.source
  const decoration: monaco.editor.IModelDeltaDecoration = {
    options: {
      className: 'monaco-inspectorHoveringDecorator'
    },
    range: new monaco.Range(
      data.loc.start.line,
      data.loc.start.column,
      data.loc.end.line,
      data.loc.end.column,
    ),
  }

  editorStore.fileDecorations.add(path, decoration)
  e.currentTarget?.addEventListener('mouseleave', () => editorStore.fileDecorations.delete(path, decoration))
}

function handleItemClick(e: MouseEvent, data: InspectorRuntimeApi.PickResultNode) {
  editorStore.openFileAndGoTo(data.loc.source, {
    startLineNumber: data.loc.start.line,
    startColumn: data.loc.start.column,
    endLineNumber: data.loc.end.line,
    endColumn: data.loc.end.column,
  })
  e.preventDefault()
}
</script>

<template>
  <div ref="anchorRef" style="position: absolute; left: 0; top: 0"></div>
  <div v-if="canDisplay" :class="$style.mask" @click="emits('close')"></div>
  <div v-if="canDisplay" :class="$style.wrapper" ref="wrapperRef">
    <div v-for="node, idx in nodes" :key="idx" @mouseenter="handleItemMouseEnter($event, node)" :class="$style.item"
      @click="handleItemClick($event, node)">
      {{ node.type }} -
      {{ node.loc.source }} - {{ node.loc.start.line }}:{{ node.loc.start.column }}
    </div>
  </div>
</template>

<style lang="scss" module>
.wrapper {
  position: absolute;
  z-index: 100;
  @apply bg-white border border-gray-300 rounded-md shadow-lg;
  @apply animate-fade-in animate-duration-100;
}

.item {
  @apply px-2 py-1 text-gray-700 hover:bg-gray-100 cursor-pointer;
}

.mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background-color: rgba(0, 0, 0, 0.1);
}
</style>
