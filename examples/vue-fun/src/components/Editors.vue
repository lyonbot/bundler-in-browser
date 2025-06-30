<template>
    <Tabs v-model="activeFilePath" theme="card" @remove="e => closeFile(e.value as string)" style="height: 100%">
        <TabPanel v-for="path in editorStore.openedFiles" :key="path" :value="path" :label="path" removable>
            <div class="flex-1 relative h-screen">
                <MonacoEditor :path="path" class="h-full" />
            </div>
        </TabPanel>
    </Tabs>
</template>

<script setup lang="ts">
import MonacoEditor from "@/monaco/MonacoEditor.vue";
import { useFileEditorStore } from "@/store/fileEditor";
import { TabPanel, Tabs } from "tdesign-vue-next";
import { computed } from "vue";

const editorStore = useFileEditorStore();
const activeFilePath = computed({
    get: () => editorStore.activeFilePath,
    set: (value) => editorStore.activeFilePath = value,
})

const { closeFile } = editorStore;

</script>