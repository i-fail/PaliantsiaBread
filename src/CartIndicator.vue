<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { cartCount } from './cart'
</script>

<template>
  <RouterLink v-if="cartCount > 0" class="cart-indicator" to="/checkout" :aria-label="`Cart: ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`">
    <img src="/cart.svg" alt="" width="28" height="28" />
    <span class="cart-count" aria-hidden="true">{{ cartCount }}</span>
  </RouterLink>
</template>
