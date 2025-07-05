<template>
  <div class="counter">
    <!-- Message Section -->
    <h1 class="message-heading">{{ message }}</h1>

    <!-- Count Section -->
    <div class="count-display">
      <p class="count-label">Current Count:</p>
      <span class="count-value">{{ count }}</span>
    </div>

    <!-- Action Button -->
    <div class="flex items-center gap-4">
      <button class="action-button" @click="count++">
        Increment
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ml-2" fill="none" viewBox="0 0 24 24"
          stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      </button>

      <button class="action-button is-error" @click="makeError">
        Throw Error
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import confetti from 'canvas-confetti'
import { hi, makeError } from './utils'

defineProps<{}>()

const message = hi()
const count = ref(0)

onMounted(() => {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
  }) // 🎊 tada!
})
</script>

<style scoped lang="scss">
.message-heading {
  @apply text-5xl md:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600 mb-4 tracking-tight leading-tight;
}

.count-display {
  @apply flex items-center gap-3 mb-4 bg-emerald-50 text-emerald-800 px-6 py-3 rounded-full border border-emerald-200 shadow-sm;
}

.count-label {
  @apply text-lg font-semibold text-emerald-700;
}

.count-value {
  @apply text-3xl font-bold text-emerald-900;
}

.action-button {
  @apply inline-flex items-center justify-center px-8 py-4 bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold rounded-xl shadow-lg transition-all duration-300 ease-in-out transform hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-emerald-300 focus:ring-opacity-75 active:scale-95;

  &.is-error {
    @apply bg-gradient-to-br from-red-500 to-orange-600 text-white focus:ring-red-300;
  }
}

/* Optional: Basic body styling for the demo page */
body {
  @apply bg-gradient-to-br from-gray-50 to-gray-200 min-h-screen flex items-center justify-center p-4 font-sans;
}
</style>
