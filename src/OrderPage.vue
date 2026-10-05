<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { orderStatuses, orderStatusLabel, type OrderDetails, type OrderStatus } from '../shared/orders'
import { formatPrice } from '../shared/products'
import CartIndicator from './CartIndicator.vue'
import { ApiError } from './content-api'
import { getOrderDetails, isAdminSession, updateOrderStatus } from './orders-api'

const year = new Date().getFullYear()
const route = useRoute()
const order = ref<OrderDetails | null>(null)
const loading = ref(true)
const notFound = ref(false)
const error = ref('')
// Anyone with the link can see the order. Admins (signed in) also get controls for managing it.
const isAdmin = ref(false)

async function load() {
  const slug = String(route.params.slug)
  loading.value = true
  notFound.value = false
  error.value = ''
  order.value = null
  try {
    const found = await getOrderDetails(slug)
    // Ignore a slow answer for an order the visitor already left.
    if (slug === route.params.slug) order.value = found
  } catch (cause) {
    if (slug !== route.params.slug) return
    if (cause instanceof ApiError && cause.status === 404) notFound.value = true
    else error.value = cause instanceof Error ? cause.message : 'Unable to load this order.'
  } finally {
    if (slug === route.params.slug) loading.value = false
  }
}

// Changing the status is for admins only. The page shows the control only to a signed-in admin, and the
// server checks the admin session again for every change. The new status is saved as soon as it is chosen,
// and the old one comes back if saving fails.
const statusSaving = ref(false)
const statusMessage = ref('')
const statusError = ref('')

async function changeStatus(event: Event) {
  const select = event.target as HTMLSelectElement
  const current = order.value
  const next = select.value as OrderStatus
  if (!current || next === current.status) return

  statusSaving.value = true
  statusMessage.value = ''
  statusError.value = ''
  try {
    const saved = await updateOrderStatus(current.slug, next)
    // Ignore the answer if the admin has already moved on to another order.
    if (order.value?.slug === saved.slug) order.value = saved
    statusMessage.value = `Status changed to ${orderStatusLabel(saved.status)}.`
  } catch (cause) {
    select.value = current.status
    if (cause instanceof ApiError && cause.status === 401) {
      // The session ended: this visitor is no longer an admin, so the control goes away.
      isAdmin.value = false
      statusError.value = 'Your session expired. Sign in again to change the status.'
    } else {
      statusError.value = cause instanceof Error ? cause.message : 'Unable to change the status. Please try again.'
    }
  } finally {
    statusSaving.value = false
  }
}

const placedAt = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })

// The page holds personal details, so search engines are asked to leave it out.
let robots: HTMLMetaElement | null = null
onMounted(async () => {
  robots = document.createElement('meta')
  robots.name = 'robots'
  robots.content = 'noindex'
  document.head.append(robots)
  isAdmin.value = await isAdminSession()
})
onBeforeUnmount(() => robots?.remove())

watch(() => route.params.slug, load, { immediate: true })
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <nav class="header-nav" aria-label="Main">
        <RouterLink v-if="isAdmin" class="header-link" to="/admin/orders">← All orders</RouterLink>
        <RouterLink class="header-link" to="/buy">Buy bread</RouterLink>
        <RouterLink class="header-link" to="/contact">Contact</RouterLink>
        <CartIndicator />
      </nav>
    </header>

    <main class="buy-main order-page" aria-label="Order">
      <p v-if="loading" role="status">Loading order…</p>

      <div v-else-if="notFound" role="alert">
        <p>We couldn’t find that order.</p>
        <RouterLink class="action-button" :to="isAdmin ? '/admin/orders' : '/buy'">{{ isAdmin ? 'See all orders' : 'Browse our bread' }}</RouterLink>
      </div>

      <div v-else-if="error" role="alert">
        <p class="error-message">{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>

      <article v-else-if="order">
        <div class="order-heading">
          <h1 class="admin-title order-title">Order <span class="order-reference">{{ order.slug }}</span></h1>
          <!-- Only unpaid orders can be paid. Taking payment is not built yet, so for now the button does nothing. -->
          <button v-if="order.status === 'unpaid'" class="action-button order-pay" type="button">Pay</button>
        </div>
        <p class="order-meta">
          <label v-if="isAdmin" class="order-status-field">
            <span>Status</span>
            <select class="order-status-select" :class="`is-${order.status}`" :value="order.status" :disabled="statusSaving" @change="changeStatus">
              <option v-for="status in orderStatuses" :key="status" :value="status">{{ orderStatusLabel(status) }}</option>
            </select>
          </label>
          <span v-else class="order-status-field">
            <span>Status</span>
            <strong class="order-status" :class="`is-${order.status}`" data-testid="order-status">{{ orderStatusLabel(order.status) }}</strong>
          </span>
          <span>Placed {{ placedAt(order.createdAt) }}</span>
        </p>
        <p v-if="statusMessage" class="save-message order-status-note" role="status">{{ statusMessage }}</p>
        <p v-if="statusError" class="error-message order-status-note" role="alert">
          {{ statusError }}
          <RouterLink v-if="statusError.startsWith('Your session')" to="/admin/orders">Sign in</RouterLink>
        </p>

        <div class="order-details">
          <section aria-labelledby="order-contact-title">
            <h2 id="order-contact-title">Contact</h2>
            <dl class="order-facts">
              <div><dt>Email</dt><dd>{{ order.email }}</dd></div>
              <div><dt>Phone</dt><dd>{{ order.phone }}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="order-delivery-title">
            <h2 id="order-delivery-title">{{ order.address ? 'Shipping address' : 'Delivery' }}</h2>
            <address v-if="order.address">
              {{ order.address.name }}<br />
              {{ order.address.street }}<br />
              {{ order.address.city }}, {{ order.address.state }} {{ order.address.zip }}
            </address>
            <p v-else>Pickup — nothing to ship.</p>
          </section>
        </div>

        <section aria-labelledby="order-items-title">
          <h2 id="order-items-title">Items</h2>
          <div class="orders-table-wrap">
            <table class="orders-table order-items">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">SKU</th>
                  <th scope="col" class="orders-number">Price</th>
                  <th scope="col" class="orders-number">Qty</th>
                  <th scope="col">Delivery</th>
                  <th scope="col" class="orders-number">Total</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in order.items" :key="item.productId">
                  <th scope="row">{{ item.title }}</th>
                  <td>{{ item.sku }}</td>
                  <td class="orders-number">{{ formatPrice(item.unitPriceCents) }}</td>
                  <td class="orders-number">{{ item.quantity }}</td>
                  <td>{{ item.delivery === 'ship' ? 'Ship' : 'Pickup' }}</td>
                  <td class="orders-number">{{ formatPrice(item.unitPriceCents * item.quantity) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="order-totals" aria-labelledby="order-totals-title">
          <h2 id="order-totals-title">Totals</h2>
          <dl class="order-facts">
            <div><dt>Items</dt><dd>{{ formatPrice(order.subtotalCents) }}</dd></div>
            <div>
              <dt>Shipping<span v-if="order.boxes" class="order-note"> · {{ order.boxes }} {{ order.boxes === 1 ? 'box' : 'boxes' }} for {{ order.shippedUnits }} shipped {{ order.shippedUnits === 1 ? 'item' : 'items' }}</span></dt>
              <dd>{{ order.boxes ? formatPrice(order.shippingCents) : 'None' }}</dd>
            </div>
            <div class="order-total"><dt>Total</dt><dd>{{ formatPrice(order.totalCents) }}</dd></div>
          </dl>
        </section>
      </article>
    </main>

    <footer class="site-footer">
      <p>© {{ year }} Palianytsia Bread</p>
      <RouterLink class="footer-link" to="/contact">Contact</RouterLink>
      <p class="footer-note"><span class="ukraine-mark" aria-hidden="true"></span> Rooted in Ukrainian tradition.</p>
    </footer>
  </div>
</template>
