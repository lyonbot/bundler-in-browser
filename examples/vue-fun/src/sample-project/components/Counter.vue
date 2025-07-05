<template>
  <div class="count-display">
    <p class="count-label">{{ label }}:</p>
    <span class="count-value">{{ count }}</span>
  </div>

  <div class="flex items-center gap-2">
    <button class="action-button action-button-sm" @click="emit('decrement')">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
      </svg>
    </button>
    
    <button class="action-button action-button-sm" @click="emit('increment')">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
    </button>
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