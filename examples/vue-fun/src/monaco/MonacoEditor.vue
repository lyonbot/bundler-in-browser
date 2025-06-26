<template>
  <div ref="editorContainer" class="monaco-editor-container"></div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import * as monaco from "monaco-editor-core";
import "./setup";

const props = defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  language: {
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
let editor = null;

onMounted(() => {
  const model = monaco.editor.createModel(props.modelValue, props.language, monaco.Uri.parse('file:///Foo.vue'));

  // Initialize Monaco Editor
  editor = monaco.editor.create(editorContainer.value, {
    // value: props.modelValue,
    // language: props.language,
    model,
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

// Watch for external value changes
watch(
  () => props.modelValue,
  (newValue) => {
    if (editor && editor.getValue() !== newValue) {
      editor.setValue(newValue);
    }
  }
);

// Watch for language changes
watch(
  () => props.language,
  (newLanguage) => {
    if (editor) {
      const model = editor.getModel();
      monaco.editor.setModelLanguage(model, newLanguage);
    }
  }
);

onUnmounted(() => {
  if (editor) {
    editor.dispose();
  }
});
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  height: 400px;
  position: relative;
  overflow: hidden;
}
</style>
