<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { normalizePhone, orderLimits, shippingStates, zipPattern, type PlacedOrder } from '../shared/orders'
import { cartTotals, shippingBox } from '../shared/pricing'
import { formatPrice, type Product } from '../shared/products'
import { cartItems, clearCart, maxQuantity, removeFromCart, setDelivery, setQuantity } from './cart'
import CartIndicator from './CartIndicator.vue'
import { ApiError } from './content-api'
import { placeOrder } from './orders-api'
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
    return { quantity: item.quantity, delivery: item.delivery, productId: item.productId, product: product && product.priceCents !== null ? product : null }
  })
})

const totals = computed(() => cartTotals(lines.value.flatMap(line => line.product
  ? [{ priceCents: line.product.priceCents!, quantity: line.quantity, shipped: line.product.shippingAvailable && line.delivery === 'ship' }]
  : [])))

const hasAvailable = computed(() => lines.value.some(line => line.product))
// Units the customer will collect themselves: everything available that is not being shipped.
const pickupUnits = computed(() => lines.value.reduce((total, line) => total + (line.product ? line.quantity : 0), 0) - totals.value.shippedUnits)
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

// Buyer details. The address is only asked for, and only sent, when something is being shipped.
const buyer = reactive({ email: '', phone: '', name: '', street: '', city: '', state: '', zip: '' })
const needsAddress = computed(() => totals.value.shippedUnits > 0)
// Every field that is currently shown must be filled in (spaces alone do not count) before ordering.
const formComplete = computed(() => {
  const required = needsAddress.value
    ? [buyer.email, buyer.phone, buyer.name, buyer.street, buyer.city, buyer.state, buyer.zip]
    : [buyer.email, buyer.phone]
  return required.every(value => value.trim() !== '')
})
// The dropdown shows two-letter codes, so it is ordered by code (AL, AR, AZ, ...) rather than by state name.
const stateCodeOptions = shippingStates.map(([code]) => code).sort()
const placing = ref(false)
const orderError = ref('')
const placed = ref<{ order: PlacedOrder; email: string; shipped: boolean } | null>(null)

async function submitOrder() {
  orderError.value = ''
  if (!normalizePhone(buyer.phone)) {
    orderError.value = 'Enter a valid US phone number, for example (424) 408-0552.'
    return
  }
  placing.value = true
  try {
    const order = await placeOrder({
      // A product that cannot be shipped is always picked up, whatever the cart remembers.
      items: lines.value.filter(line => line.product).map(line => ({
        productId: line.productId,
        quantity: line.quantity,
        delivery: line.product!.shippingAvailable ? line.delivery : 'pickup' as const,
      })),
      email: buyer.email,
      phone: buyer.phone,
      ...(needsAddress.value ? { address: { name: buyer.name, street: buyer.street, city: buyer.city, state: buyer.state, zip: buyer.zip } } : {}),
    })
    placed.value = { order, email: buyer.email.trim(), shipped: order.shippedUnits > 0 }
    clearCart()
    window.scrollTo({ top: 0 })
  } catch (cause) {
    orderError.value = cause instanceof Error ? cause.message : 'We couldn’t place your order right now. Please try again or call us.'
    // The cart may have changed on the server (an item sold out or was repriced): show the latest.
    if (cause instanceof ApiError && cause.status === 409) await load()
  } finally {
    placing.value = false
  }
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

      <section v-if="placed" class="checkout-confirmation" aria-labelledby="order-placed-title">
        <h2 id="order-placed-title">Thank you! Your order has been placed.</h2>
        <p>Your order reference is <strong class="order-reference">{{ placed.order.slug }}</strong>. Please keep it for your records.</p>
        <p>Total: <strong>{{ formatPrice(placed.order.totalCents) }}</strong>
          <span v-if="placed.order.shippingCents"> (including {{ formatPrice(placed.order.shippingCents) }} shipping)</span>.</p>
        <p>We’ve received your order and will contact you at {{ placed.email }} with the next steps.</p>
        <RouterLink class="action-button checkout-continue" to="/buy">Continue shopping</RouterLink>
      </section>

      <p v-else-if="!lines.length" class="checkout-empty" role="status">
        Your cart is empty. <RouterLink class="contact-link" to="/buy">Browse our bread</RouterLink>
      </p>
      <p v-else-if="loading" role="status">Loading your cart…</p>
      <div v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>

      <div v-else class="checkout-layout">
        <div class="checkout-column">
          <ul class="checkout-items" aria-label="Items in your cart">
            <li v-for="line in lines" :key="line.productId" class="checkout-item" :class="{ 'is-unavailable': !line.product }">
              <template v-if="line.product">
                <div class="checkout-thumb">
                  <img v-if="mainPhoto(line.product)" :src="mainPhoto(line.product)!.url" alt="" width="80" height="80" />
                </div>
                <div class="checkout-info">
                  <RouterLink class="checkout-title" :to="`/buy/${line.product.slug}`">{{ line.product.title }}</RouterLink>
                  <span class="checkout-unit">{{ formatPrice(line.product.priceCents!) }} each</span>
                  <div v-if="line.product.shippingAvailable" class="checkout-delivery" role="radiogroup" :aria-label="`Delivery for ${line.product.title}`">
                    <span class="checkout-delivery-label" aria-hidden="true">Delivery:</span>
                    <label><input type="radio" :name="`delivery-${line.productId}`" value="ship" :checked="line.delivery === 'ship'" @change="setDelivery(line.productId, 'ship')" /> Ship</label>
                    <label><input type="radio" :name="`delivery-${line.productId}`" value="pickup" :checked="line.delivery === 'pickup'" @change="setDelivery(line.productId, 'pickup')" /> Pickup</label>
                  </div>
                  <span v-else class="checkout-no-shipping">Pickup only</span>
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

          <form v-if="hasAvailable" class="checkout-form" @submit.prevent="submitOrder">
            <h2>Your details</h2>
            <div class="checkout-fields">
              <div class="checkout-field">
                <label for="buyer-email">Email</label>
                <input id="buyer-email" v-model="buyer.email" type="email" required autocomplete="email" :maxlength="orderLimits.email" :disabled="placing" />
              </div>
              <div class="checkout-field">
                <label for="buyer-phone">Phone</label>
                <input id="buyer-phone" v-model="buyer.phone" type="tel" required autocomplete="tel" inputmode="tel" maxlength="30" :disabled="placing" />
              </div>
            </div>

            <template v-if="needsAddress">
              <h3>Shipping address</h3>
              <p class="admin-help">We ship within the contiguous United States.</p>
              <div class="checkout-fields">
                <div class="checkout-field checkout-field-wide">
                  <label for="buyer-name">Name</label>
                  <input id="buyer-name" v-model="buyer.name" required autocomplete="shipping name" :maxlength="orderLimits.name" :disabled="placing" />
                </div>
                <div class="checkout-field checkout-field-wide">
                  <label for="buyer-street">Street address</label>
                  <input id="buyer-street" v-model="buyer.street" required autocomplete="shipping street-address" :maxlength="orderLimits.street" :disabled="placing" />
                </div>
                <div class="checkout-field">
                  <label for="buyer-city">City</label>
                  <input id="buyer-city" v-model="buyer.city" required autocomplete="shipping address-level2" :maxlength="orderLimits.city" :disabled="placing" />
                </div>
                <div class="checkout-field">
                  <label for="buyer-state">State</label>
                  <select id="buyer-state" v-model="buyer.state" required autocomplete="shipping address-level1" :disabled="placing">
                    <option value="" disabled>Select a state</option>
                    <option v-for="code in stateCodeOptions" :key="code" :value="code">{{ code }}</option>
                  </select>
                </div>
                <div class="checkout-field">
                  <label for="buyer-zip">ZIP code</label>
                  <input id="buyer-zip" v-model="buyer.zip" required autocomplete="shipping postal-code" inputmode="numeric" maxlength="10" :pattern="zipPattern.source" title="A 5-digit ZIP code, such as 92626 or 92626-1234" :disabled="placing" />
                </div>
              </div>
            </template>

            <p v-if="orderError" class="error-message" role="alert">{{ orderError }}</p>
            <button class="action-button checkout-place" type="submit" aria-describedby="checkout-place-help" :disabled="placing || !formComplete">{{ placing ? 'Placing order…' : 'Place order' }}</button>
            <p v-if="!formComplete" id="checkout-place-help" class="admin-help checkout-place-help">Fill in all the fields above to place your order.</p>
          </form>
        </div>

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
          <p v-if="pickupUnits > 0" class="admin-help checkout-pickup-note">{{ plural(pickupUnits, 'item') }} for pickup, with no shipping charge.</p>
          <p class="admin-help">Shipping is {{ formatPrice(shippingBox.cents) }} per box, and each box holds up to {{ shippingBox.capacity }} products. Items for pickup are charged only their price.</p>
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
