<template>
    <Dialog v-model:visible="aiModal.shown" header="AI Assistant" :closeOnEscKeydown="true" :closeOnOverlayClick="true"
        width="700px" top="10%" class="ai-chat-modal" :footer="false">
        <template #body>
            <div class="flex flex-col h-96">
                <!-- Context information -->
                <div v-if="aiModal.contextParts.length > 0"
                    class="mb-4 p-3 bg-gray-1 rounded text-sm overflow-auto max-h-40">
                    <div v-for="(part, index) in aiModal.contextParts" :key="index" class="mb-2">
                        <div v-html="formatContextPart(part)"></div>
                    </div>
                </div>

                <!-- Chat messages -->
                <div class="flex-1 overflow-auto mb-4 p-2" ref="messagesContainer">
                    <template v-if="conversation && conversation.messages.length > 0">
                        <div v-for="(msg, index) in conversation.messages" :key="index" class="mb-4">
                            <div class="font-bold mb-1">{{ msg.role === 'user' ? 'You' : 'AI Assistant' }}</div>
                            <div v-if="msg.role === 'user'" class="whitespace-pre-wrap">{{ msg.content }}</div>
                            <div v-else class="whitespace-pre-wrap">
                                <template v-for="(block, blockIndex) in msg.content" :key="blockIndex">
                                    <pre class="whitespace-pre-wrap">{{ block }}</pre>
                                </template>
                            </div>
                        </div>
                    </template>
                    <div v-else class="text-center text-gray-5 my-8">
                        Ask me anything about your code or project!
                    </div>
                </div>

                <!-- Input area -->
                <div class="mt-auto">
                    <Textarea v-model="aiModal.inputBoxContent" placeholder="Ask a question..."
                        :autosize="{ minRows: 2, maxRows: 5 }" :disabled="conversation?.loading" @keydown="sendMessage"
                        ref="inputBox" />
                    <div class="flex justify-between items-center mt-2">
                        <div class="text-xs text-gray-5">
                            Press {{ isMac ? '⌘' : 'Ctrl' }}+Enter to send
                        </div>
                        <div class="flex gap-2">
                            <Button v-if="conversation?.loading" theme="danger" variant="outline"
                                @click="abortConversation">
                                Cancel
                            </Button>
                            <Button theme="primary" :loading="conversation?.loading"
                                :disabled="!aiModal.inputBoxContent.trim()" @click="sendMessage">
                                Send
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </template>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, Button, Textarea, type TdTextareaProps } from "tdesign-vue-next";
import { useAIChatStore } from "@/store/aiChat";
import { computed, ref, watch, nextTick } from "vue";
import { marked } from "marked";
import { toRefs } from "vue";
import { modKey } from "yon-utils";

const aiChatStore = useAIChatStore();
const { aiModal, sendMessage: storeSendMessage, abortConversation } = aiChatStore
const { conversation } = toRefs(aiChatStore);

const messagesContainer = ref<HTMLElement | null>(null);
const inputBox = ref<InstanceType<typeof Textarea> | null>(null);
const isMac = computed(() => navigator.platform.toUpperCase().indexOf('MAC') >= 0);

// Scroll to bottom when new messages arrive
watch(
    () => conversation.value?.messages.length,
    async () => {
        await nextTick();
        if (messagesContainer.value) {
            messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
        }
    },
    { immediate: true }
);

// Auto focus and select input when modal is shown
watch(
    () => aiModal.shown,
    async (newValue) => {
        if (newValue) {
            await nextTick();
            if (inputBox.value) {
                const textareaElement = inputBox.value.$el.querySelector('textarea');
                if (textareaElement) {
                    textareaElement.focus();
                    textareaElement.select();
                }
            }
        }
    }
);

// Format context parts with markdown
function formatContextPart(part: string) {
    return marked.parse(part, { breaks: true });
}

// Send message function
const sendMessage: TdTextareaProps["onKeydown"] = async function (_, { e }) {
    if (!(e.code === 'Enter' && modKey(e) === modKey.Mod)) return
    if (!aiModal.inputBoxContent.trim() || conversation.value?.loading) return;

    const message = aiModal.contextParts.join('\n\n') + '\n\n' + aiModal.inputBoxContent;
    aiModal.inputBoxContent = "";

    try {
        await storeSendMessage(message);
    } catch (error) {
        console.error("Failed to send message:", error);
    }
}
</script>

<style scoped>
.ai-chat-modal :deep(.t-dialog__body) {
    padding: 16px;
}

.ai-chat-modal :deep(pre) {
    background-color: #f5f5f5;
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
}

.ai-chat-modal :deep(code) {
    font-family: monospace;
    background-color: #f5f5f5;
    padding: 2px 4px;
    border-radius: 3px;
}
</style>