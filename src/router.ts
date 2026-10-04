import { createRouter, createWebHistory } from 'vue-router'

// Each route is loaded on demand, so every page ships as its own chunk.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./HomePage.vue') },
    { path: '/buy', component: () => import('./BuyPage.vue') },
    { path: '/buy/:slug', component: () => import('./ProductPage.vue') },
    { path: '/admin', component: () => import('./AdminPage.vue') },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})
