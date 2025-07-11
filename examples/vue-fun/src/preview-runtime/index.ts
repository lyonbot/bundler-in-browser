import * as Vue from 'vue'
import App from './App.vue'
import './runtime-handler'

import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css';
import { editorApi } from './runtime-handler';

const app = Vue.createApp(App)

app.use(TDesign)
app.config.errorHandler = (err, instance, info) => {
  console.error('[vue-err]', err, instance, info)

  const file = instance?.$options?.__file
  if (file) editorApi.addRuntimeError({
    message: (err as any)?.message || String(err),
    file,
  })
}
app.config.warnHandler = (msg, instance, trace) => {
  console.warn('[vue-warn]', msg, instance, trace)
}

app.mount('#root')
