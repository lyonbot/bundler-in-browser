import * as Vue from 'vue'
import App from './App.vue'
import './runtime-handler'

import TDesign from 'tdesign-vue-next'
import 'tdesign-vue-next/es/style/index.css';

Vue.createApp(App)
  .use(TDesign)
  .mount('#root')
