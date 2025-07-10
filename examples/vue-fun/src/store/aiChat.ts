import { basicOpenAIChat } from "@/abilities/openai-stream/openai-conversaion";
import { msgBlocksToOpenAIMessages, processOpenAIStream, type MsgBlock } from "@/abilities/openai-stream/openai-stream";
import { useLocalStorage } from "@vueuse/core";
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import * as monaco from 'monaco-editor-core'
import { useFileEditorStore } from "./fileEditor";

export interface ChatConversation {
    conversationId: string
    model: string
    loading: boolean
    messages: Array<
        { role: 'user', content: string }
        | { role: 'assistant', content: MsgBlock[] }
    >
    [$abort]?: () => void
}

const defaultModel = 'gemini-2.5-flash'
const $abort = Symbol()

export const useAIChatStore = defineStore('aiChat', () => {
    const conversations = ref<ChatConversation[]>([]);
    const serviceSource = useLocalStorage('aiChatServiceSource', {
        apiKey: '',
        url: '',
    })

    const conversation = computed(() => conversations.value.at(-1));
    function newConversation() {
        const c: ChatConversation = {
            model: conversation.value?.model || defaultModel,
            conversationId: Date.now().toString(),
            loading: false,
            messages: [],
        }
        conversations.value.push(c)
        return conversations.value.at(-1)!;
    }

    async function sendMessage(userMessage: string) {
        const c = conversation.value || newConversation()
        if (c.loading) throw new Error('Previous message is still loading')

        const ctrl = new AbortController()
        const lastMessage = c.messages.at(-1)
        if (lastMessage?.role === 'user') c.messages.pop()  // maybe last failed?

        c[$abort] = () => { ctrl.abort() }
        c.loading = true;
        c.messages.push({
            role: 'user',
            content: userMessage,
        })

        try {
            const stream = basicOpenAIChat({
                model: c.model,
                messages: [
                    {
                        role: 'system',
                        content: getSystemPrompt(),
                    },
                    ...c.messages.map(it => {
                        if (it.role === 'user') return { role: it.role, content: it.content }
                        if (it.role === 'assistant') return { role: it.role, content: msgBlocksToOpenAIMessages(it.content) }
                    })
                ],
            }, {
                apiKey: serviceSource.value.apiKey,
                url: serviceSource.value.url,
                signal: ctrl.signal,
            })

            const parsed = processOpenAIStream(stream, {
                onBlockCreate(block, index) {
                    if (index === 0) {
                        // first block generated! add data to conversation
                        c.messages.push({
                            role: 'assistant',
                            content: parsed.msgBlocks,
                        })
                    }
                },
            })
            await parsed.completePromise
        } catch (err) {
            console.error('ai error', err)
        }

        c.loading = false
        c[$abort] = undefined
    }

    function abortConversation() {
        const c = conversation.value
        if (!c) return
        c[$abort]?.()
    }

    // ------

    const aiModal = reactive({
        shown: false,
        inputBoxContent: '',
        contextParts: [] as string[],
    })
    function showAIModalAtEditor() {
        let editor = monaco.editor.getEditors().find(x => x.hasTextFocus())
        if (!editor) {
            const { pathToEditors, activeFilePath } = useFileEditorStore()
            editor = pathToEditors.get(activeFilePath)[0]
        }
        if (!editor) return

        const model = editor.getModel()
        if (model?.uri?.scheme !== 'file') return

        const path = model.uri.path
        const range = editor.getSelection()!

        aiModal.contextParts = [];
        aiModal.contextParts.push(`File: ${path}`)
        if (range.isEmpty()) {
            aiModal.contextParts.push(
                `Line: ${range.startLineNumber}\n` +
                '```\n' +
                model.getLineContent(range.startLineNumber) +
                '\n```'
            )
        } else {
            aiModal.contextParts.push(
                `Range: ${range.startLineNumber}-${range.endLineNumber}\n` +
                '```\n' +
                model.getValueInRange({
                    startLineNumber: range.startLineNumber,
                    endLineNumber: range.endLineNumber + 1,
                    startColumn: 0,
                    endColumn: 0,
                }) +
                '\n```'
            )
        }

        aiModal.shown = true
    }

    // register action for all new editor
    monaco.editor.addEditorAction({
        id: 'show-ai-modal',
        label: 'Show AI Modal',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL,
        ],
        run: () => {
            showAIModalAtEditor()
        }
    })

    return {
        conversations,
        conversation,
        sendMessage,
        abortConversation,

        aiModal,
        showAIModalAtEditor,
    }
})

function getSystemPrompt() {
    return `
    You are professional vue3 component developer, good at tailwind-css, component separating, typescript, project structure.


    `.trim().replace(/^    /gm, '')
}