<template>
  <div ref="editorContainer" class="monaco-editor-container"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, watchEffect } from "vue";
import * as monaco from "monaco-editor-core";
import { random } from "lodash-es";
import { useFileEditorStore } from "@/store/fileEditor";
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

const emit = defineEmits(["update:modelValue"]);

const editorContainer = ref(null);
/** @type {monaco.editor.IStandaloneCodeEditor} */
let editor = null;
/** @type {monaco.editor.ITextModel} */
let currentModel = null;

const editorStore = useFileEditorStore()
const tempUri = monaco.Uri.from({ scheme: 'in-memory', path: random(0, 1e9).toString(36) })

watch(() => props.path, (path, _, onCleanup) => {
  /** @type {monaco.editor.ITextModel} */
  let model;
  if (!path) { //useTempUri
    let model = monaco.editor.getModel(tempUri)
    if (!model) {
      model = monaco.editor.createModel(props.modelValue, props.language, tempUri)
      onCleanup(() => { model.dispose() })
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

  currentModel = model
  editor?.setModel(model)
}, { immediate: true })

onMounted(() => {
  // Initialize Monaco Editor
  editor = monaco.editor.create(editorContainer.value, {
    // value: props.modelValue,
    // language: props.language,
    model: currentModel,
    automaticLayout: true,
    fixedOverflowWidgets: true,
    ...props.options,
  });

  // Listen for content changes
  editor.onDidChangeModelContent(() => {
    const value = editor.getValue();
    emit("update:modelValue", value);
  });
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
