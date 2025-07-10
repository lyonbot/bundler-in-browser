<template>
  <div class="flex h-screen">
    <div class="flex-0 flex flex-col overflow-auto" :style="{ flexBasis: `${fileListWidth}px` }">
      <FileTree />
      <div class="mt-a">
        <Button @click="persistStore.resetProject" theme="default">
          <template #icon>
            <RefreshIcon />
          </template>
          Reset Project
        </Button>
      </div>
    </div>
    <div class="w-1 touch-none hover:bg-gray-2 cursor-ew-resize" @pointerdown="startResizeFileList"></div>

    <div class="flex-1 min-w-0 flex flex-col relative contain-size" :style="{ flexGrow: editorWidthFactor }">
      <Editors />

      <!-- AI Chat Button -->
      <div class="absolute right-4 bottom-4 z-100">
        <Button shape="circle" theme="primary" @click="toggleAIModal">
          <template #icon>
            <ChatIcon />
          </template>
        </Button>
      </div>
    </div>
    <div class="w-1 touch-none hover:bg-gray-2 cursor-ew-resize" @pointerdown="startResizeEditor"></div>

    <div class="flex-1 min-w-0 z-100" :style="{ flexGrow: 1 - editorWidthFactor }">
      <!-- z-100 for monaco overlay bug -->
      <Preview />
    </div>
  </div>

  <div v-if="loading"
    class="fixed left-50% top-50% translate-x-[-50%] translate-y-[-50%] flex flex-col items-center justify-center">
    <Loading />
    <div class="mt-4 text-xl">Loading Bundler and Environment...</div>
  </div>

  <!-- AI Chat Modal -->
  <AIChatModal />
</template>

<script setup lang="ts">
import { useBundlerController } from "./store/bundler";
import { Button } from "tdesign-vue-next";

const { readyPromise, compile } = useBundlerController();

import { useEventListener, useLocalStorage } from "@vueuse/core";
import { ref } from "vue";
import { modKey } from "yon-utils";
import Editors from "./components/Editors.vue";
import FileTree from "./components/FileTree";
import Preview from "./components/Preview.vue";
import { Loading } from "tdesign-vue-next";
import { createResizeHandler } from "./utils/resizing";
import { usePersistStore } from "./store/persistStore";
import { ChatIcon, RefreshIcon } from "tdesign-icons-vue-next";
import AIChatModal from "./components/AIChatModal.vue";
import { useAIChatStore } from "./store/aiChat";

const loading = ref(true);
const persistStore = usePersistStore();
const aiChatStore = useAIChatStore();

readyPromise.then(async () => {
  loading.value = false;
  await persistStore.loadProject();
  await compile();
});

useEventListener(window, 'keydown', e => {
  if (modKey(e) === modKey.Mod && e.code === 'KeyS') {
    compile();
    persistStore.storeProject();
    e.preventDefault();
  }
})

// Toggle AI Modal
function toggleAIModal() {
  aiChatStore.showAIModalAtEditor()
  // aiChatStore.aiModal.shown = !aiChatStore.aiModal.shown;
}

// ----------------------------------------------
const fileListWidth = useLocalStorage('file-list-width', 220)
const editorWidthFactor = useLocalStorage('editor-width-factor', 0.5)
const startResizeFileList = createResizeHandler([
  { axis: 'x', ref: fileListWidth, min: 100, max: 500 },
])
const startResizeEditor = createResizeHandler([
  {
    axis: 'x',
    ref: editorWidthFactor,
    min: 0.1,
    max: 0.9,
    scale: () => 1 / (window.innerWidth - fileListWidth.value),
  },
])
</script>
