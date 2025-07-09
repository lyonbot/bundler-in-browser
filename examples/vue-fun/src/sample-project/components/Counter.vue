<template>
  <div class="count-display">
    <p class="count-label">{{ label }}:</p>
    <span class="count-value">{{ count }}</span>
  </div>

  <div class="flex items-center gap-2">
    <t-button @click="emit('decrement')" theme="default">-1</t-button>
    <t-button @click="emit('increment')" theme="default">+1</t-button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  count: number
  label?: string
}>()

const emit = defineEmits<{
  (e: 'increment'): void
  (e: 'decrement'): void
}>()
</script>

<style scoped lang="scss">
.count-display {
  @apply flex items-center gap-3 mb-2 bg-emerald-50 text-emerald-800 px-6 py-3 rounded-full border border-emerald-200 shadow-sm;
}

.count-label {
  @apply text-lg font-semibold text-emerald-700;
}

.count-value {
  @apply text-3xl font-bold text-emerald-900;
}

.action-button-sm {
  @apply px-4 py-2;
}
</style>