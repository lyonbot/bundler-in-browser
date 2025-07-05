<template>
  <div class="todo-container">
    <h3 class="todo-title">{{ title }}</h3>
    
    <div class="todo-input-group">
      <input 
        v-model="newTask" 
        @keyup.enter="addTask"
        type="text" 
        placeholder="Add a new task..."
        class="todo-input"
      />
      <button @click="addTask" class="todo-add-btn">
        Add
      </button>
    </div>
    
    <div v-if="tasks.length === 0" class="empty-state">
      No tasks yet. Add one above!
    </div>
    
    <ul v-else class="todo-list">
      <li v-for="(task, index) in tasks" :key="index" class="todo-item" :class="{ 'is-completed': task.completed }">
        <div class="flex items-center gap-2">
          <input 
            type="checkbox" 
            :checked="task.completed"
            @change="toggleTask(index)"
            class="todo-checkbox"
          />
          <span class="todo-text">{{ task.text }}</span>
        </div>
        <button @click="removeTask(index)" class="todo-delete-btn">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </li>
    </ul>
    
    <div class="todo-stats" v-if="tasks.length > 0">
      <span>{{ completedCount }} of {{ tasks.length }} completed</span>
      <button @click="clearCompleted" class="todo-clear-btn" v-if="completedCount > 0">
        Clear completed
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { generateId } from '../utils'

interface Task {
  id: string
  text: string
  completed: boolean
}

const props = defineProps<{
  title?: string
}>()

const tasks = ref<Task[]>([])
const newTask = ref('')

const completedCount = computed(() => {
  return tasks.value.filter(task => task.completed).length
})

function addTask() {
  if (newTask.value.trim()) {
    tasks.value.push({
      id: generateId(),
      text: newTask.value.trim(),
      completed: false
    })
    newTask.value = ''
  }
}

function toggleTask(index: number) {
  tasks.value[index].completed = !tasks.value[index].completed
}

function removeTask(index: number) {
  tasks.value.splice(index, 1)
}

function clearCompleted() {
  tasks.value = tasks.value.filter(task => !task.completed)
}
</script>

<style scoped lang="scss">
.todo-container {
  @apply bg-white p-4 rounded-xl shadow-md border border-gray-200 w-full max-w-md;
}

.todo-title {
  @apply text-xl font-bold mb-4 text-gray-800;
}

.todo-input-group {
  @apply flex mb-4;
}

.todo-input {
  @apply flex-1 px-4 py-2 border border-gray-300 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent;
}

.todo-add-btn {
  @apply px-4 py-2 bg-emerald-500 text-white font-medium rounded-r-lg hover:bg-emerald-600 transition-colors;
}

.todo-list {
  @apply divide-y divide-gray-200;
}

.todo-item {
  @apply py-3 px-2 flex justify-between items-center;
  
  &.is-completed .todo-text {
    @apply line-through text-gray-400;
  }
}

.todo-checkbox {
  @apply h-5 w-5 text-emerald-500 rounded focus:ring-emerald-400;
}

.todo-text {
  @apply ml-2 text-gray-700;
}

.todo-delete-btn {
  @apply text-gray-400 hover:text-red-500 transition-colors;
}

.todo-stats {
  @apply mt-4 pt-3 border-t border-gray-200 flex justify-between items-center text-sm text-gray-500;
}

.todo-clear-btn {
  @apply text-sm text-emerald-600 hover:text-emerald-800 hover:underline;
}

.empty-state {
  @apply py-6 text-center text-gray-500 italic;
}
</style>