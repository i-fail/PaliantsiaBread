import { createRouter, createWebHistory } from 'vue-router'
import HomePage from './HomePage.vue'
import BuyPage from './BuyPage.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: HomePage },
    { path: '/buy', component: BuyPage },
    { path: '/buy/:slug', component: () => import('./ProductPage.vue') },
    { path: '/admin', component: () => import('./AdminPage.vue') },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})
