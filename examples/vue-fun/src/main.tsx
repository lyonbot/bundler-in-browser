import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import 'virtual:uno.css'

createApp(App)
  .use(createPinia())
  .mount('#root')
