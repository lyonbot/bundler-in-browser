export const hi = () => 'hi' as const

export function makeError() {
  throw new Error('uh on error')
}

// Generate a random ID for elements like todo items
export function generateId(): string {
  return Math.random().toString(36).substring(2, 10)
}

// Format a date in a friendly way
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).format(date)
}

// Simple debounce function
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  
  return function(...args: Parameters<T>) {
    if (timeout !== null) {
      clearTimeout(timeout)
    }
    
    timeout = setTimeout(() => {
      fn(...args)
      timeout = null
    }, delay)
  }
}

// Get a random greeting
export function getRandomGreeting(): string {
  const greetings = [
    'Hello',
    'Hi there',
    'Greetings',
    'Welcome',
    'Hey',
    'Howdy'
  ]
  
  return greetings[Math.floor(Math.random() * greetings.length)]
}
