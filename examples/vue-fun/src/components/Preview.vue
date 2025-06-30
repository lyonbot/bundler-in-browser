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

            <Loading :indicator="!runtimeConnection.isConnected" size="small" />
        </div>
        <iframe src="previewer.html" frameborder="0" ref="iframeRef"></iframe>
    </div>
</template>

<script setup lang="ts">
import { PlayCircleFilledIcon, RefreshIcon } from 'tdesign-icons-vue-next';
import { Button, Loading, Tooltip } from 'tdesign-vue-next';
import { ref } from 'vue';
import { MOD_KEY_LABEL } from 'yon-utils'

import { useRuntimeConnection } from '@/store/runtimeConnection';
import { useBundlerController } from '@/store/bundler';
import { useEventListener } from '@vueuse/core';

const bundler = useBundlerController();
const runtimeConnection = useRuntimeConnection();

const iframeRef = ref<HTMLIFrameElement>();
function refresh() {
    if (iframeRef.value) {
        iframeRef.value.contentWindow?.location.reload();
    }
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
}
</script>

<style lang="scss">
.preview-container {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.preview-container iframe {
    flex: 1;
    contain: layout;
    border: 0;
}
</style>
