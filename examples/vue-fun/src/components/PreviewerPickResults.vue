<!-- a component to display the popup menu with nodes picked by clicking -->

<script setup lang="ts">
import type { InspectorRuntimeApi } from '@/abilities/vue-inspector/constants';
import { useFileEditorStore } from '@/store/fileEditor';
import * as monaco from 'monaco-editor-core';
import { computed, ref, toRaw, watch, watchPostEffect } from 'vue';
import { createPopper } from '@popperjs/core';
import { useEventListener } from '@vueuse/core';
import { Chart3DFilledIcon, CodeIcon } from 'tdesign-icons-vue-next';
import { basename } from 'path';
import MonacoEditor from '@/monaco/MonacoEditor.vue';
import { type Nil, type RectLike } from 'yon-utils';
import { useRuntimeConnection } from '@/store/runtimeConnection';

const editorStore = useFileEditorStore()
const runtimeConnection = useRuntimeConnection()

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

const lastClickedNode = ref<InspectorRuntimeApi.PickResultNode | null>(null)
let targetRectInRuntime: RectLike | Nil = null // for popper.js to sync position

watchPostEffect((onCleanUp) => {
  if (!canDisplay.value) {
    targetRectInRuntime = null
    lastClickedNode.value = null
    return
  }

  const wrapper = wrapperRef.value
  const anchor = anchorRef.value
  if (!wrapper || !anchor) return

  const rectSyncTimer = setInterval(() => {
    const selector = nodes[0]?.selector
    if (!selector) return
    runtimeConnection.inspectorApi.queryElementRect(selector).then(rect => {
      targetRectInRuntime = rect
      popper.update()
    })
  }, 200)
  onCleanUp(() => clearInterval(rectSyncTimer))
  targetRectInRuntime = nodes[0]?.rect

  const popper = createPopper(
    {
      getBoundingClientRect: () => {
        const rect = targetRectInRuntime || new DOMRect(0, 0, 0, 0)
        const anchorRect = anchor.getBoundingClientRect()
        return new DOMRect(rect.x + anchorRect.left, rect.y + anchorRect.top, rect.width, rect.height)
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
  lastClickedNode.value = data
  const range: monaco.IRange = {
    startLineNumber: data.loc.start.line,
    startColumn: data.loc.start.column,
    endLineNumber: data.loc.end.line,
    endColumn: data.loc.end.column,
  };
  editorStore.openFileAndGoTo(data.loc.source, range)
  monacoEditor?.revealRangeInCenterIfOutsideViewport(range)
  e.preventDefault()
}

const monacoOptions: monaco.editor.IEditorConstructionOptions = {
  lineNumbers: 'off',
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 4,
  padding: { top: 4 },
  lineNumbersMinChars: 0
}

let monacoEditor: monaco.editor.IStandaloneCodeEditor | null = null
function handleMonacoReady(editor: monaco.editor.IStandaloneCodeEditor) {
  monacoEditor = editor
  if (lastClickedNode.value) {
    const loc = lastClickedNode.value.loc
    editor.revealRangeInCenterIfOutsideViewport({
      startLineNumber: loc.start.line,
      startColumn: loc.start.column,
      endLineNumber: loc.end.line,
      endColumn: loc.end.column,
    })
  }

  // FIXME: too ugly way to sync position to other editors
  editor.onDidChangeCursorPosition(e => {
    if (e.reason !== monaco.editor.CursorChangeReason.Explicit) return // only sync when user move cursor

    const path = lastClickedNode.value?.loc.source
    if (!path) return

    const otherEditor = editorStore.pathToEditors.get(path).find(e => toRaw(e) !== editor)
    if (!otherEditor) return

    otherEditor.setPosition(e.position)
  })
}
watch(     // auto select the node by current active editor's position
  () => canDisplay.value,
  (canDisplay) => {
    if (!canDisplay) return

    const path = editorStore.activeFilePath
    const pos = editorStore.pathToEditors.get(path)[0]?.getPosition()
    if (!pos) return

    // find the node
    const node = nodes.find(n => n.loc.source === path && new monaco.Range(
      n.loc.start.line,
      n.loc.start.column,
      n.loc.end.line,
      n.loc.end.column,
    ).containsPosition(pos))
    if (!node) return

    lastClickedNode.value = node
  },
)
</script>

<template>
  <div ref="anchorRef" style="position: absolute; left: 0; top: 0"></div>
  <div v-if="canDisplay" :class="$style.mask" @click="emits('close')"></div>
  <div v-if="canDisplay" :class="$style.wrapper" ref="wrapperRef">

    <!-- node list menu -->
    <div class="w-40 overflow-auto">
      <div v-for="node, idx in nodes" :key="idx" :class="{
        [$style.item]: true,
        [$style.componentItem]: node.type === 'component',
        ['font-bold']: toRaw(node) === toRaw(lastClickedNode),
      }" @mouseenter="handleItemMouseEnter($event, node)" @click="handleItemClick($event, node)">

        <CodeIcon class="self-center" v-if="node.type === 'node'" />
        <Chart3DFilledIcon class="self-center text-emerald-600" v-if="node.type === 'component'" />

        <span class="text-sm">{{ basename(node.loc.source) }}</span>
        <span class="text-xs op-50">{{ node.loc.start.line }}:{{ node.loc.start.column }}</span>
      </div>
    </div>

    <!-- peek editor -->
    <div class="w-90 relative b-l b-l-gray-200 b-l-solid">
      <MonacoEditor class="h-full w-full" v-if="lastClickedNode" :path="lastClickedNode.loc.source"
        @ready="handleMonacoReady" :options="monacoOptions" />
    </div>
  </div>
</template>

<style lang="scss" module>
.wrapper {
  position: absolute;
  z-index: 100;
  height: 200px;
  overflow: hidden;
  border: 1px solid #0009;
  @apply bg-white border border-gray-300 rounded-md shadow-xl;
  @apply animate-fade-in animate-duration-100;
  @apply flex;
}

.item {
  @apply px-2 py-1 text-gray-700 hover:bg-gray-100 cursor-pointer;
  @apply flex items-baseline gap-1;

  &.componentItem {
    @apply text-emerald-800 b-b b-b-solid b-b-emerald-200;
    @apply bg-gradient-from-white to-emerald-50 bg-gradient-to-b;
    @apply hover:bg-gradient-from-emerald-50 hover:to-emerald-100;
  }
}

.mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background-color: rgba(0, 0, 0, 0.1);
}
</style>
