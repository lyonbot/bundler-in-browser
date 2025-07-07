<template>
  <div ref="editorContainer" class="monaco-editor-container"></div>
</template>

<script setup lang="ts">
import { useFileEditorStore } from "@/store/fileEditor";
import { random } from "lodash-es";
import * as monaco from "monaco-editor-core";
import { onMounted, onUnmounted, ref, watch, watchEffect } from "vue";
import type { Nil } from "yon-utils";
import "./setup";

const props = defineProps({
  path: {
    type: String,
    default: "",
  },
  modelValue: {  // not available when `path` is set
    type: String,
    default: "",
  },
  language: {  // not available when `path` is set
    type: String,
    default: "javascript",
  },
  options: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "ready": [editor: monaco.editor.IStandaloneCodeEditor];
}>();

const editorContainer = ref<HTMLElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | Nil = null;
let currentModel: monaco.editor.ITextModel | Nil = null;

const editorStore = useFileEditorStore()
const tempUri = monaco.Uri.from({ scheme: 'in-memory', path: random(0, 1e9).toString(36) })

watch(() => props.path, (path, _, onCleanup) => {
  /** @type {monaco.editor.ITextModel} */
  let model: monaco.editor.ITextModel;
  if (!path) { //useTempUri
    let model = monaco.editor.getModel(tempUri)
    if (!model) {
      model = monaco.editor.createModel(props.modelValue, props.language, tempUri)
      onCleanup(() => { model!.dispose() })
    }
    model.setValue(props.modelValue)
    onCleanup(watchEffect(() => {
      if (!editor) return
      if (editor.getModel() !== model) return
      monaco.editor.setModelLanguage(model, props.language)
    }))
    onCleanup(watch(
      () => props.modelValue,
      (newValue) => {
        if (!editor) return
        if (editor.getModel() !== model) return
        if (editor.getValue() === newValue) return
        editor.setValue(newValue);
      }
    ))
  } else {
    model = editorStore.getMonacoModelOfPath(path)
  }

  currentModel = model!
  editor?.setModel(model!)
}, { immediate: true })

onMounted(() => {
  // Initialize Monaco Editor
  editor = monaco.editor.create(editorContainer.value!, {
    // value: props.modelValue,
    // language: props.language,
    model: currentModel,
    automaticLayout: true,
    fixedOverflowWidgets: true,
    autoClosingBrackets: 'always',
    autoClosingDelete: 'always',
    autoClosingQuotes: 'always',
    autoIndent: 'advanced',
    autoClosingOvertype: 'auto',
    ...props.options,
  });

  // Listen for content changes
  editor.onDidChangeModelContent(() => {
    const value = editor!.getValue();
    emit("update:modelValue", value);
  });

  emit("ready", editor);
});

onUnmounted(() => {
  if (editor) editor.dispose();
});
</script>

<style scoped>
.monaco-editor-container {
  position: relative;
  overflow: hidden;
}
</style>
