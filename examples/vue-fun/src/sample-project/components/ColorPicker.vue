<template>
  <div class="color-picker">
    <h3 class="color-picker-title">{{ title }}</h3>
    <div class="color-swatches">
      <button 
        v-for="color in colors" 
        :key="color.value"
        class="color-swatch"
        :class="{ 'is-selected': modelValue === color.value }"
        :style="{ backgroundColor: color.value }"
        @click="emit('update:modelValue', color.value)"
        :title="color.name"
      ></button>
    </div>
    <div class="selected-color-info">
      <span>Selected: </span>
      <span class="color-name">{{ selectedColorName }}</span>
      <div class="color-preview" :style="{ backgroundColor: modelValue }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface ColorOption {
  name: string
  value: string
}

const props = defineProps<{
  modelValue: string
  title?: string
  colors?: ColorOption[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const defaultColors: ColorOption[] = [
  { name: 'Emerald', value: '#10b981' },
  { name: 'Sky', value: '#0ea5e9' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
]

const colors = computed(() => props.colors || defaultColors)

const selectedColorName = computed(() => {
  const found = colors.value.find(c => c.value === props.modelValue)
  return found ? found.name : 'Custom'
})
</script>

<style scoped lang="scss">
.color-picker {
  @apply bg-white p-4 rounded-xl shadow-md border border-gray-200;
}

.color-picker-title {
  @apply text-lg font-bold mb-3 text-gray-700;
}

.color-swatches {
  @apply flex flex-wrap gap-2 mb-3;
}

.color-swatch {
  @apply w-8 h-8 rounded-full cursor-pointer transition-all duration-200 border-2 border-transparent;
  
  &:hover {
    @apply transform scale-110;
  }
  
  &.is-selected {
    @apply border-white ring-2 ring-gray-400;
  }
}

.selected-color-info {
  @apply flex items-center text-sm text-gray-600;
}

.color-name {
  @apply font-medium mx-1;
}

.color-preview {
  @apply w-4 h-4 rounded-full ml-1;
}
</style>