import { createRouter, createWebHistory } from 'vue-router'

// Each route is loaded on demand, so every page ships as its own chunk.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./HomePage.vue') },
    { path: '/buy', component: () => import('./BuyPage.vue') },
    { path: '/buy/:slug', component: () => import('./ProductPage.vue') },
    { path: '/contact', component: () => import('./ContactPage.vue') },
    { path: '/checkout', component: () => import('./CheckoutPage.vue') },
    // One order, in full. Admin only: the API refuses it without an admin session.
    { path: '/order/:slug', component: () => import('./OrderPage.vue') },
    { path: '/admin', redirect: '/admin/front' },
    // One route record for both tabs, so the page stays mounted (and keeps unsaved edits) when switching.
    { path: '/admin/:tab(front|products|orders)', component: () => import('./AdminPage.vue') },
    { path: '/admin/:rest(.*)*', redirect: '/admin/front' },
  ],
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition ?? { top: 0 }
  },
})
