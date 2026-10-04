<script setup lang="ts">
import { onMounted, ref } from 'vue'
import CartIndicator from './CartIndicator.vue'
import { RouterLink } from 'vue-router'
import { formatPrice, type Product } from '../shared/products'
import AddToCartButton from './AddToCartButton.vue'
import { listPublicProducts } from './products-api'

const year = new Date().getFullYear()
const products = ref<Product[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    products.value = await listPublicProducts()
  } catch {
    error.value = 'Our bread is temporarily unavailable. Please try again.'
  } finally {
    loading.value = false
  }
}

function mainPhoto(product: Product) {
  return product.photos.find(photo => photo.id === product.mainPhotoId) ?? product.photos[0]
}

onMounted(load)
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <nav class="header-nav" aria-label="Main">
        <RouterLink class="header-link" to="/">Our story</RouterLink>
        <RouterLink class="header-link" to="/contact">Contact</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main aria-label="Buy bread" class="buy-main">
      <p v-if="loading" role="status">Loading our bread…</p>
      <div v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>
      <p v-else-if="!products.length" role="status">No bread is available right now. Please check back soon.</p>
      <ul v-else class="buy-grid">
        <li v-for="product in products" :key="product.id" class="buy-card">
          <RouterLink v-if="mainPhoto(product)" :to="`/buy/${product.slug}`" tabindex="-1" aria-hidden="true">
            <img class="buy-photo" :src="mainPhoto(product)!.url" alt="" :width="mainPhoto(product)!.width" :height="mainPhoto(product)!.height" />
          </RouterLink>
          <h2><RouterLink :to="`/buy/${product.slug}`">{{ product.title }}</RouterLink></h2>
          <div v-if="product.priceCents !== null" class="buy-price-row">
            <p class="buy-price">{{ formatPrice(product.priceCents) }}</p>
            <AddToCartButton :product-id="product.id" :title="product.title" />
          </div>
          <p v-if="product.shippingAvailable" class="buy-shipping">Shipping available</p>
          <p class="buy-sku">SKU {{ product.sku }}</p>
          <p v-if="product.description" class="buy-description">{{ product.description }}</p>
        </li>
      </ul>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
