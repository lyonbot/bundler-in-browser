<template>
    <div v-if="compilingErrors.length" class="p-4 space-y-3">
        <div v-for="it in compilingErrors" @click="openItem(it)"
            class="p-3 rounded-lg bg-gray-100/80 hover:bg-gray-200/80 cursor-pointer transition-colors duration-200 shadow-sm hover:shadow">
            <div class="text-red-500 ws-pre font-mono text-10px mb-1">{{ it.message }}</div>
            <div class="text-10px text-gray-500 flex items-center gap-1">
                <span class="i-carbon-document text-gray-400"></span>
                {{ it.file }}

                <template v-if="typeof it.line === 'number'">
                    <span class="mx-1">•</span>
                    <span class="flex items-center gap-1">
                        <span class="i-carbon-code text-gray-400"></span>
                        {{ it.line }}:{{ it.column }}
                    </span>
                </template>
            </div>
        </div>
        <!-- <div v-if="!compilingErrors.length" class="text-center py-6 text-gray-400">
            No errors found
        </div> -->
    </div>
</template>

<script setup lang="ts">
import { useBundlerController } from '@/store/bundler';
import { useFileEditorStore } from '@/store/fileEditor';
import { computed } from 'vue';


const bundler = useBundlerController();
const editorStore = useFileEditorStore();

const compilingErrors = computed(() => bundler.compilingErrors)
const openItem = (it: (typeof compilingErrors)['value'][number]) => {
    if (!it.file) return
    if (typeof it.line !== 'number') editorStore.openFile(it.file);
    else {
        editorStore.openFileAndGoTo(
            it.file,
            { lineNumber: it.line!, column: it.column! }
        )
    }
}
</script>