<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { orderStatusLabel, type OrderSummary } from '../shared/orders'
import { formatPrice } from '../shared/products'
import { ApiError } from './content-api'
import { listOrders } from './orders-api'

const emit = defineEmits<{ unauthorized: [] }>()
const router = useRouter()

const orders = ref<OrderSummary[]>([])
const loading = ref(true)
const loaded = ref(false)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    orders.value = await listOrders()
    loaded.value = true
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) emit('unauthorized')
    else error.value = cause instanceof Error ? cause.message : 'Unable to load orders.'
  } finally {
    loading.value = false
  }
}

const placedAt = (iso: string) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

// The whole row is clickable; the reference link inside it remains the keyboard and screen reader route.
function open(slug: string, event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a')) return
  router.push(`/order/${slug}`)
}

onMounted(load)
</script>

<template>
  <div class="orders-admin">
    <p v-if="loading" role="status">Loading orders…</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button v-if="!loading && !loaded" type="button" class="action-button" @click="load">Try again</button>

    <p v-if="loaded && !orders.length" class="admin-help orders-empty">No orders yet.</p>

    <div v-if="orders.length" class="orders-table-wrap">
      <table class="orders-table">
        <caption class="sr-only">Orders, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Placed</th>
            <th scope="col">Customer</th>
            <th scope="col" class="orders-number">Items</th>
            <th scope="col">Delivery</th>
            <th scope="col" class="orders-number">Total</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="order in orders" :key="order.slug" class="orders-row" @click="open(order.slug, $event)">
            <th scope="row"><RouterLink class="orders-link" :to="`/order/${order.slug}`">{{ order.slug }}</RouterLink></th>
            <td>{{ placedAt(order.createdAt) }}</td>
            <td class="orders-email">{{ order.email }}</td>
            <td class="orders-number">{{ order.itemCount }}</td>
            <td>{{ order.shippedUnits > 0 ? 'Shipping' : 'Pickup' }}</td>
            <td class="orders-number">{{ formatPrice(order.totalCents) }}</td>
            <td><span class="order-status" :class="`is-${order.status}`">{{ orderStatusLabel(order.status) }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="orders.length >= 500" class="admin-help">Showing the 500 most recent orders.</p>
  </div>
</template>
