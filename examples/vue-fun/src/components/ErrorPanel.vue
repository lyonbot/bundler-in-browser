<template>
    <div v-if="combinedErrors.length" class="p-4 space-y-3">
        <div v-for="it in combinedErrors" @click="openItem(it)"
            class="p-3 rounded-lg bg-gray-100/80 hover:bg-gray-200/80 cursor-pointer transition-colors duration-200 shadow-sm hover:shadow">
            <div class="text-red-500 ws-pre font-mono text-sm mb-1">{{ it.message }}</div>
            <div class="text-xs text-gray-500 flex items-center gap-1">
                <span class="i-carbon-document text-gray-400"></span>
                {{ it.file }}

                <template v-if="('line' in it) && typeof it.line === 'number'">
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
import { useRuntimeConnection } from '@/store/runtimeConnection';
import { computed } from 'vue';


const bundler = useBundlerController();
const editorStore = useFileEditorStore();
const runtimeStore = useRuntimeConnection()

const compilingErrors = computed(() => bundler.compilingErrors)
const runtimeErrors = computed(() => runtimeStore.errorMessages)
const combinedErrors = computed(() => [...compilingErrors.value, ...runtimeErrors.value].reverse())

const openItem = (it: (typeof combinedErrors)['value'][number]) => {
    if (!it.file) return
    if (!('line' in it) || typeof it.line !== 'number') editorStore.openFile(it.file);
    else {
        editorStore.openFileAndGoTo(
            it.file,
            { lineNumber: it.line!, column: it.column! }
        )
    }
}
</script>