import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import ui from '@nuxt/ui/vue-plugin';
import App from './App.vue';
import './style.css';

const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: App }] });
createApp(App).use(router).use(ui).mount('#app');
