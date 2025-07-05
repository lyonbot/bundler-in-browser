<template>
  <div class="app-container" :style="{ '--theme-color': themeColor }">
    <!-- Message Section -->
    <h1 class="message-heading">{{ greeting }} {{ currentTime }}</h1>
    
    <div class="app-content">
      <div class="app-section">
        <!-- Counter Components -->
        <div class="counters-container">
          <Counter 
            :count="count" 
            label="Main Counter"
            @increment="count++" 
            @decrement="count--"
          />
          
          <Counter 
            :count="secondaryCount" 
            label="Secondary Counter"
            @increment="secondaryCount += 2" 
            @decrement="secondaryCount -= 2"
          />
        </div>
        
        <!-- Action Buttons -->
        <div class="flex items-center gap-4 mt-4">
          <button class="action-button" @click="triggerConfetti">
            Celebrate
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ml-2" fill="none" viewBox="0 0 24 24"
              stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          <button class="action-button is-error" @click="makeError">
            Throw Error
          </button>
        </div>
      </div>
      
      <div class="app-section">
        <!-- Color Picker -->
        <ColorPicker 
          v-model="themeColor"
          title="Choose Theme Color"
        />
      </div>
    </div>
    
    <!-- Todo List -->
    <div class="app-section mt-6">
      <TodoList title="Task Manager" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import confetti from 'canvas-confetti'
import { makeError, getRandomGreeting, formatDate, debounce } from './utils'
import Counter from './components/Counter.vue'
import ColorPicker from './components/ColorPicker.vue'
import TodoList from './components/TodoList.vue'

defineProps<{}>()

// State
const count = ref(0)
const secondaryCount = ref(10)
const themeColor = ref('#10b981') // Default emerald
const greeting = ref(getRandomGreeting())

// Computed
const currentTime = computed(() => {
  return formatDate(new Date())
})

// Methods
function triggerConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors: [themeColor.value, '#ffffff', '#333333']
  })
}

// Debounced function example
const updateGreeting = debounce(() => {
  greeting.value = getRandomGreeting()
}, 500)

// Lifecycle hooks
onMounted(() => {
  triggerConfetti() // Initial celebration
  
  // Set up an interval to update the greeting occasionally
  const interval = setInterval(() => {
    updateGreeting()
  }, 10000)
  
  // Clean up the interval when component is unmounted
  onUnmounted(() => {
    clearInterval(interval)
  })
})
</script>

<style scoped lang="scss">
.app-container {
  --theme-color: #10b981;
  @apply max-w-4xl mx-auto p-6 rounded-2xl bg-white shadow-xl border border-gray-100;
}

.message-heading {
  @apply text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-teal-600 mb-6 tracking-tight leading-tight text-center;
  background-image: linear-gradient(to right, var(--theme-color), color-mix(in srgb, var(--theme-color), #3f83f8 60%));
}

.app-content {
  @apply flex flex-col md:flex-row gap-6;
}

.app-section {
  @apply flex-1;
}

.counters-container {
  @apply space-y-4;
}

.action-button {
  @apply inline-flex items-center justify-center px-6 py-3 bg-gradient-to-br text-white font-bold rounded-xl shadow-lg transition-all duration-300 ease-in-out transform hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-4 focus:ring-opacity-75 active:scale-95;
  background-image: linear-gradient(to bottom right, var(--theme-color), color-mix(in srgb, var(--theme-color), #000 30%));

  &.is-error {
    @apply bg-gradient-to-br from-red-500 to-orange-600 text-white focus:ring-red-300;
  }
}

/* Optional: Basic body styling for the demo page */
body {
  @apply bg-gradient-to-br from-gray-50 to-gray-200 min-h-screen flex items-center justify-center p-4 font-sans;
}
</style>
