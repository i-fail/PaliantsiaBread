<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { cartTotals, shippingBox } from '../shared/pricing'
import { formatPrice, type Product } from '../shared/products'
import { cartItems, maxQuantity, removeFromCart, setQuantity } from './cart'
import CartIndicator from './CartIndicator.vue'
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
    error.value = 'We couldn’t load the latest prices. Please try again.'
  } finally {
    loading.value = false
  }
}

// Prices always come from the current product list, never from what was stored when the item was added.
const lines = computed(() => {
  const byId = new Map(products.value.map(product => [product.id, product]))
  return cartItems.value.map(item => {
    const product = byId.get(item.productId)
    // A product that was disabled, deleted, or never priced cannot be bought.
    return { quantity: item.quantity, productId: item.productId, product: product && product.priceCents !== null ? product : null }
  })
})

const totals = computed(() => cartTotals(lines.value.flatMap(line => line.product
  ? [{ priceCents: line.product.priceCents!, quantity: line.quantity, shippingAvailable: line.product.shippingAvailable }]
  : [])))

const hasAvailable = computed(() => lines.value.some(line => line.product))
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function mainPhoto(product: Product) {
  return product.photos.find(photo => photo.id === product.mainPhotoId) ?? product.photos[0]
}

function changeQuantity(productId: number, event: Event) {
  const input = event.target as HTMLInputElement
  setQuantity(productId, Number(input.value))
  // Show the value that was actually kept (for example when 0 or blank is typed).
  input.value = String(cartItems.value.find(item => item.productId === productId)?.quantity ?? '')
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
        <RouterLink class="header-link" to="/buy">Buy bread</RouterLink>
        <RouterLink class="header-link" to="/contact">Contact</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main aria-label="Checkout" class="buy-main checkout-main">
      <h1>Checkout</h1>

      <p v-if="!lines.length" class="checkout-empty" role="status">
        Your cart is empty. <RouterLink class="contact-link" to="/buy">Browse our bread</RouterLink>
      </p>
      <p v-else-if="loading" role="status">Loading your cart…</p>
      <div v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>

      <div v-else class="checkout-layout">
        <ul class="checkout-items" aria-label="Items in your cart">
          <li v-for="line in lines" :key="line.productId" class="checkout-item" :class="{ 'is-unavailable': !line.product }">
            <template v-if="line.product">
              <div class="checkout-thumb">
                <img v-if="mainPhoto(line.product)" :src="mainPhoto(line.product)!.url" alt="" width="80" height="80" />
              </div>
              <div class="checkout-info">
                <RouterLink class="checkout-title" :to="`/buy/${line.product.slug}`">{{ line.product.title }}</RouterLink>
                <span class="checkout-unit">{{ formatPrice(line.product.priceCents!) }} each</span>
                <span v-if="line.product.shippingAvailable" class="buy-shipping">Shipping available</span>
                <span v-else class="checkout-no-shipping">Shipping not available</span>
              </div>
              <div class="checkout-quantity">
                <label :for="`quantity-${line.productId}`">Quantity<span class="sr-only"> of {{ line.product.title }}</span></label>
                <input :id="`quantity-${line.productId}`" type="number" inputmode="numeric" min="1" :max="maxQuantity" step="1" :value="line.quantity" @change="changeQuantity(line.productId, $event)" />
              </div>
              <p class="checkout-line-total">{{ formatPrice(line.product.priceCents! * line.quantity) }}</p>
              <button class="sign-out-button checkout-remove" type="button" :aria-label="`Remove ${line.product.title}`" @click="removeFromCart(line.productId)">Remove</button>
            </template>
            <template v-else>
              <p class="checkout-unavailable">This item is no longer available and isn’t included in your total.</p>
              <button class="sign-out-button checkout-remove" type="button" aria-label="Remove unavailable item" @click="removeFromCart(line.productId)">Remove</button>
            </template>
          </li>
        </ul>

        <section v-if="hasAvailable" class="checkout-summary" aria-labelledby="checkout-summary-title">
          <h2 id="checkout-summary-title">Order summary</h2>
          <dl>
            <div><dt>Items</dt><dd>{{ formatPrice(totals.subtotalCents) }}</dd></div>
            <div>
              <dt>Shipping<span v-if="totals.boxes" class="checkout-shipping-detail"> · {{ plural(totals.boxes, 'box', 'boxes') }} for {{ plural(totals.shippedUnits, 'shipped item') }}</span></dt>
              <dd>{{ totals.boxes ? formatPrice(totals.shippingCents) : 'None' }}</dd>
            </div>
            <div class="checkout-total"><dt>Total</dt><dd>{{ formatPrice(totals.totalCents) }}</dd></div>
          </dl>
          <p class="admin-help">Shipping is {{ formatPrice(shippingBox.cents) }} per box, and each box holds up to {{ shippingBox.capacity }} products. Products without shipping are charged only their price.</p>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
