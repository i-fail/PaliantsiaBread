<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CartIndicator from './CartIndicator.vue'
import { RouterLink, useRoute } from 'vue-router'
import { formatPrice, type Product } from '../shared/products'
import { ApiError } from './content-api'
import AddToCartButton from './AddToCartButton.vue'
import { getPublicProduct } from './products-api'

const route = useRoute()
const year = new Date().getFullYear()
const product = ref<Product | null>(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref('')
const chosenPhotoId = ref<number | null>(null)

const photo = computed(() => {
  const current = product.value
  if (!current) return null
  return current.photos.find(item => item.id === (chosenPhotoId.value ?? current.mainPhotoId)) ?? current.photos[0] ?? null
})

async function load() {
  const slug = String(route.params.slug)
  loading.value = true
  notFound.value = false
  error.value = ''
  product.value = null
  chosenPhotoId.value = null
  try {
    const found = await getPublicProduct(slug)
    // Ignore a slow answer for a page the visitor already left.
    if (slug === route.params.slug) product.value = found
  } catch (cause) {
    if (slug !== route.params.slug) return
    if (cause instanceof ApiError && cause.status === 404) notFound.value = true
    else error.value = 'This bread is temporarily unavailable. Please try again.'
  } finally {
    if (slug === route.params.slug) loading.value = false
  }
}

watch(() => route.params.slug, load, { immediate: true })
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <nav class="header-nav" aria-label="Main">
        <RouterLink class="header-link" to="/buy">All bread</RouterLink>
        <RouterLink class="header-link" to="/contact">Contact</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main class="buy-main product-page" aria-label="Product">
      <p v-if="loading" role="status">Loading…</p>
      <div v-else-if="notFound" role="alert">
        <p>We couldn’t find that bread. It may no longer be available.</p>
        <RouterLink class="action-button" to="/buy">See all bread</RouterLink>
      </div>
      <div v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>
      <article v-else-if="product" class="product-detail">
        <div class="product-gallery">
          <img v-if="photo" class="buy-photo" :src="photo.url" :alt="product.title" :width="photo.width" :height="photo.height" />
          <ul v-if="product.photos.length > 1" class="buy-thumbs" :aria-label="`${product.title} photos`">
            <li v-for="(item, index) in product.photos" :key="item.id">
              <button type="button" :aria-label="`Show photo ${index + 1}`" :aria-pressed="item.id === photo?.id" @click="chosenPhotoId = item.id">
                <img :src="item.url" alt="" width="64" height="64" />
              </button>
            </li>
          </ul>
        </div>
        <div class="product-info">
          <RouterLink class="back-link" to="/buy">← All bread</RouterLink>
          <h1>{{ product.title }}</h1>
          <div v-if="product.priceCents !== null" class="buy-price-row">
            <p class="buy-price">{{ formatPrice(product.priceCents) }}</p>
            <AddToCartButton :product-id="product.id" :title="product.title" />
          </div>
          <p v-if="product.shippingAvailable" class="buy-shipping">Shipping available</p>
          <p class="buy-sku">SKU {{ product.sku }}</p>
          <p v-if="product.description" class="buy-description">{{ product.description }}</p>
        </div>
      </article>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
