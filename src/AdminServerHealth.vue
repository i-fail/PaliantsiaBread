<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ServerHealth } from '../shared/health'
import { ApiError } from './content-api'
import { getServerHealth } from './health-api'

const emit = defineEmits<{ unauthorized: [] }>()

const health = ref<ServerHealth | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    health.value = await getServerHealth()
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) emit('unauthorized')
    else error.value = cause instanceof Error ? cause.message : 'Failed to load server health.'
  } finally {
    loading.value = false
  }
}

const circumference = 2 * Math.PI * 44
// A resource this full needs attention, so its ring turns red.
const warnAbove = 90

interface Ring {
  key: 'disk' | 'cpu' | 'ram'
  label: string
  color: string
  value: number | null
  note: string
  problem?: string
}

const rings = computed<Ring[]>(() => {
  const h = health.value
  if (!h) return []
  return [
    { key: 'disk', label: 'Disk used', color: '#365c35', value: h.disk?.usedPercent ?? null, note: h.disk ? `${gb(h.disk.remainingGb)} remaining` : '', problem: h.problems.disk },
    { key: 'cpu', label: 'Average CPU usage', color: '#b4731f', value: h.cpu?.usedPercent ?? null, note: 'Sampled across all CPU cores', problem: h.problems.cpu },
    { key: 'ram', label: 'RAM used', color: '#765035', value: h.ram?.usedPercent ?? null, note: h.ram ? `${gb(h.ram.remainingGb)} free` : '', problem: h.problems.ram },
  ]
})

const percent = (value: number) => `${value.toFixed(1)}%`
const gb = (value: number) => `${value.toFixed(1)} GB`
const dash = (value: number) => `${(Math.min(100, Math.max(0, value)) / 100) * circumference} ${circumference}`
const ringColor = (ring: Ring) => (ring.value !== null && ring.value >= warnAbove ? '#9a2b1d' : ring.color)

function daysLeft(days: number) {
  if (days < 0) return 'Expired'
  if (days < 1) return 'Under 1 day'
  const whole = Math.floor(days)
  return `${whole} ${whole === 1 ? 'day' : 'days'}`
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

onMounted(load)
</script>

<template>
  <div class="health-admin">
    <div class="health-heading">
      <div>
        <h2>Server Health</h2>
        <p class="admin-help">Live resource usage for the current server.</p>
      </div>
      <button class="action-button health-refresh" type="button" :disabled="loading" @click="load">{{ loading ? 'Refreshing…' : 'Refresh' }}</button>
    </div>

    <p v-if="loading && !health" role="status">Loading server metrics…</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>

    <div v-if="health" class="health-grid">
      <article v-for="ring in rings" :key="ring.key" class="health-card" :aria-label="ring.label" :data-metric="ring.key">
        <span class="health-label">{{ ring.label }}</span>
        <template v-if="ring.value !== null">
          <div class="health-ring">
            <svg viewBox="0 0 120 120" role="img" :aria-label="`${ring.label} ${percent(ring.value)}`">
              <circle class="health-track" cx="60" cy="60" r="44" />
              <circle class="health-fill" cx="60" cy="60" r="44" :stroke="ringColor(ring)" :stroke-dasharray="dash(ring.value)" />
            </svg>
            <div class="health-ring-center"><strong>{{ percent(ring.value) }}</strong><span>used</span></div>
          </div>
          <span class="health-note">{{ ring.note }}</span>
        </template>
        <template v-else>
          <strong class="health-value">Unavailable</strong>
          <span class="health-note health-problem">{{ ring.problem }}</span>
        </template>
      </article>

      <article class="health-card" :class="{ 'is-danger': health.ssl?.expiringSoon }" aria-label="SSL certificate" data-metric="ssl">
        <span class="health-label">SSL certificate</span>
        <template v-if="health.ssl">
          <strong class="health-value">{{ daysLeft(health.ssl.daysRemaining) }}</strong>
          <span class="health-note">{{ health.ssl.daysRemaining < 0 ? 'Expired' : 'Expires' }} {{ dateTime(health.ssl.validTo) }}</span>
          <span class="health-note health-source">Checked: {{ health.ssl.checked }}</span>
        </template>
        <template v-else>
          <strong class="health-value">Unavailable</strong>
          <span class="health-note health-problem">{{ health.problems.ssl }}</span>
        </template>
      </article>
    </div>

    <p v-if="health" class="admin-help health-checked">Last checked {{ dateTime(health.checkedAt) }}.</p>
  </div>
</template>
