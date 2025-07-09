<template>
    <div class="preview-container">
        <div class="flex gap-2">
            <Tooltip :visible="!!bundler.isCompiling" placement="bottom-left">
                <template #content>
                    <div class="text-sm min-w-40">{{ bundler.isCompiling || '🎊 Compiled.' }}</div>
                </template>
                <Button @click="compile" :loading="!!bundler.isCompiling">
                    <template #icon>
                        <PlayCircleFilledIcon />
                    </template>
                    Compile ({{ MOD_KEY_LABEL }} + S)
                </Button>
            </Tooltip>
            <Button @click="refresh" theme="default">
                <template #icon>
                    <RefreshIcon />
                </template>
                Refresh
            </Button>
            <Button @click="selectElementByClick" :theme="isPickingElement ? 'primary' : 'default'">
                <template #icon>
                    <DragDropIcon />
                </template>
                Pick Element ({{ MOD_KEY_LABEL }} + P)
            </Button>

            <Loading :indicator="!runtimeConnection.isConnected" size="small" />
        </div>
        <div class="preview-iframe-container">
            <iframe src="previewer.html" frameborder="0" ref="iframeRef"></iframe>
            <PreviewerPickResults :nodes="lastPickedResult" @close="manualClosePickResults" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { DragDropIcon, PlayCircleFilledIcon, RefreshIcon } from 'tdesign-icons-vue-next';
import { Button, Loading, Tooltip, DropdownMenu, DropdownItem, Popup } from 'tdesign-vue-next';
import { ref, shallowRef, watch, watchPostEffect } from 'vue';
import { MOD_KEY_LABEL, modKey } from 'yon-utils'
import type * as monaco from 'monaco-editor-core'

import { useRuntimeConnection } from '@/store/runtimeConnection';
import { useBundlerController } from '@/store/bundler';
import { useEventListener } from '@vueuse/core';
import { useFileEditorStore } from '@/store/fileEditor';
import type { InspectorRuntimeApi } from '@/abilities/vue-inspector/constants';
import PreviewerPickResults from './PreviewerPickResults.vue';
import { retryUntil } from '@/utils/retry';
import { usePersistStore } from '@/store/persistStore';

const bundler = useBundlerController();
const runtimeConnection = useRuntimeConnection();

const iframeRef = ref<HTMLIFrameElement>();
function refresh() {
    isPickingElement.value = false
    iframeRef.value?.contentWindow?.location.reload();
}

useEventListener(window, 'message', function handleGlobalMessage(e: MessageEvent) {
    if (e.data?.type === '__ready_for_connection__vue_fun__') {
        const source = e.source as WindowProxy;
        runtimeConnection.setupConnection((data, transferable) => {
            source.postMessage(data, '*', transferable);
        })
    }
})

function compile() {
    bundler.compile();
    usePersistStore().storeProject();
}

const lastPickedResult = shallowRef<InspectorRuntimeApi.PickResultNode[]>([])
const isPickingElement = ref(false)
async function selectElementByClick() {
    isPickingElement.value = true
    lastPickedResult.value = []
    try {
        const res = await runtimeConnection.inspectorApi.selectElementByClick()
        lastPickedResult.value = res.nodes
        const node = res.nodes[0]
        if (node) {
            const { loc } = node
            const editorStore = useFileEditorStore()

            const range: monaco.IRange = {
                startLineNumber: loc.start.line,
                startColumn: loc.start.column,
                endLineNumber: loc.end.line,
                endColumn: loc.end.column,
            };
            editorStore.openFileAndGoTo(loc.source, { ...range })

            // highlight the code for a few seconds
            const decoration: monaco.editor.IModelDeltaDecoration = {
                range,
                options: {
                    className: 'monaco-jumpHintDecorator',
                }
            }
            editorStore.fileDecorations.add(loc.source, decoration)
            setTimeout(() => editorStore.fileDecorations.delete(loc.source, decoration), 800)
        }
    } finally {
        isPickingElement.value = false
    }
}

let autoRestoreSelector: string | undefined
watch(
    () => bundler.isCompiling,
    (isCompiling) => {
        if (isCompiling) {
            // auto reset lastPickedResult when compiling start
            autoRestoreSelector ||= lastPickedResult.value[0]?.selector
            lastPickedResult.value = []
        } else {
            // and recover when finished
            const selector = autoRestoreSelector
            autoRestoreSelector = undefined
            if (selector) {
                retryUntil(async () => {
                    const res = await runtimeConnection.inspectorApi.selectElementBySelector(selector)
                    if (!res.nodes.length) return false;

                    lastPickedResult.value = res.nodes;
                    return true;
                }).then(ok => {
                    if (!ok) lastPickedResult.value = []
                })
            }
        }
    }
)
function manualClosePickResults() {
    lastPickedResult.value = []
    autoRestoreSelector = undefined
}

useEventListener(window, 'keydown', e => {
    if (modKey(e) === modKey.Mod && e.code === 'KeyP') {
        selectElementByClick()
        e.preventDefault();
    }
})
</script>

<style lang="scss">
.preview-container {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.preview-iframe-container {
    flex: 1;
    contain: layout;
    position: relative;

    iframe {
        border: 0;
        width: 100%;
        height: 100%;
    }
}
</style>
