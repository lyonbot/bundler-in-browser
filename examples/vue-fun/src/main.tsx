import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

import 'tdesign-vue-next/es/style/index.css';
import 'virtual:uno.css'

createApp(App)
  .use(createPinia())
  .mount('#root')
