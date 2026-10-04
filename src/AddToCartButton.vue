<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { addToCart } from './cart'

const props = defineProps<{ productId: number; title: string }>()
const added = ref(false)
let timer: number | undefined

function add() {
  addToCart(props.productId)
  added.value = true
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { added.value = false }, 1600)
}

onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <button class="action-button add-to-cart" type="button" :aria-label="`Add ${title} to cart`" @click="add">{{ added ? 'Added ✓' : 'Add to cart' }}</button>
  <span class="sr-only" aria-live="polite">{{ added ? `${title} added to cart` : '' }}</span>
</template>
