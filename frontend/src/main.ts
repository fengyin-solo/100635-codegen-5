import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { bootstrapHandover } from './data/handover-store'
import './styles/global.css'

// 先把认单位台账读进来并镜像到通用库，概览/看板第一次渲染就是同一个数。
bootstrapHandover()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
