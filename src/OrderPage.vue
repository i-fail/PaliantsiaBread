<script setup lang="ts">
import { ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { orderStatusLabel, type OrderDetails } from '../shared/orders'
import { formatPrice } from '../shared/products'
import { ApiError } from './content-api'
import { getOrderDetails } from './orders-api'

const route = useRoute()
const order = ref<OrderDetails | null>(null)
const loading = ref(true)
const notFound = ref(false)
const signedOut = ref(false)
const error = ref('')

async function load() {
  const slug = String(route.params.slug)
  loading.value = true
  notFound.value = false
  signedOut.value = false
  error.value = ''
  order.value = null
  try {
    const found = await getOrderDetails(slug)
    // Ignore a slow answer for an order the admin already left.
    if (slug === route.params.slug) order.value = found
  } catch (cause) {
    if (slug !== route.params.slug) return
    if (cause instanceof ApiError && cause.status === 404) notFound.value = true
    else if (cause instanceof ApiError && cause.status === 401) signedOut.value = true
    else error.value = cause instanceof Error ? cause.message : 'Unable to load this order.'
  } finally {
    if (slug === route.params.slug) loading.value = false
  }
}

const placedAt = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })

watch(() => route.params.slug, load, { immediate: true })
</script>

<template>
  <div class="site-shell admin-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <div class="admin-header-actions">
        <RouterLink to="/admin/orders">← All orders</RouterLink>
        <!-- Only unpaid orders can be paid. Taking payment is not built yet, so for now the button does nothing. -->
        <button v-if="order?.status === 'unpaid'" class="action-button order-pay" type="button">Pay</button>
      </div>
    </header>

    <main class="admin-main order-page" aria-label="Order">
      <p v-if="loading" role="status">Loading order…</p>

      <div v-else-if="signedOut" role="alert">
        <p>Sign in as an admin to see this order.</p>
        <RouterLink class="action-button" to="/admin/orders">Sign in</RouterLink>
      </div>

      <div v-else-if="notFound" role="alert">
        <p>We couldn’t find that order.</p>
        <RouterLink class="action-button" to="/admin/orders">See all orders</RouterLink>
      </div>

      <div v-else-if="error" role="alert">
        <p class="error-message">{{ error }}</p>
        <button class="action-button" type="button" @click="load">Try again</button>
      </div>

      <article v-else-if="order">
        <h1 class="admin-title order-title">Order <span class="order-reference">{{ order.slug }}</span></h1>
        <p class="order-meta">
          <span class="order-status" :class="`is-${order.status}`">{{ orderStatusLabel(order.status) }}</span>
          · Placed {{ placedAt(order.createdAt) }}
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
  </div>
</template>
