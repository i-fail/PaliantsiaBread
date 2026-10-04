<script setup lang="ts">
import { cartCount } from './cart'
</script>

<template>
  <span v-if="cartCount > 0" class="cart-indicator" role="img" :aria-label="`Cart: ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`">
    <img src="/cart.svg" alt="" width="28" height="28" />
    <span class="cart-count" aria-hidden="true">{{ cartCount }}</span>
  </span>
</template>
