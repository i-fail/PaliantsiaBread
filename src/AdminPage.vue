<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { contentFields, maxHtmlLength, type FrontPageContent } from '../shared/content'
import { ApiError, requestContent } from './content-api'
import AdminOrders from './AdminOrders.vue'
import AdminProducts from './AdminProducts.vue'

const tabs = ['front', 'products', 'orders'] as const
type Tab = (typeof tabs)[number]
const route = useRoute()
const router = useRouter()
// The tab lives in the URL (/admin/front, /admin/products, /admin/orders) so it can be bookmarked and the back button works.
const activeTab = computed<Tab>(() => tabs.find(tab => tab === route.params.tab) ?? 'front')
const selectTab = (tab: Tab) => router.push(`/admin/${tab}`)
const form = reactive<FrontPageContent>({ title: '', subtitle: '', story: '' })
const loaded = ref(false)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const message = ref('')
const password = ref('')
const authenticated = ref(false)
const checkingSession = ref(true)
const signingIn = ref(false)
const signingOut = ref(false)
const loginError = ref('')
const saved = ref('')
const dirty = computed(() => JSON.stringify(form) !== saved.value)
// Products and orders load on first visit and stay mounted so a draft survives tab switches.
const visitedProducts = ref(false)
const visitedOrders = ref(false)
watch(activeTab, tab => {
  if (tab === 'products') visitedProducts.value = true
  if (tab === 'orders') visitedOrders.value = true
})

function sessionExpired() {
  authenticated.value = false
  visitedProducts.value = false
  visitedOrders.value = false
  loginError.value = 'Your session expired. Sign in again to continue.'
}
const labels = { title: 'Title', subtitle: 'Subtitle', story: 'Story' }

async function checkSession() {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to check your session. Please sign in again.')
    authenticated.value = (await response.json()).authenticated === true
    if (authenticated.value) await loadContent()
  } catch {
    loginError.value = 'Unable to check your session. Please sign in again.'
  } finally {
    checkingSession.value = false
  }
}

async function signIn() {
  signingIn.value = true
  loginError.value = ''
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value }),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || 'Unable to sign in.')
    authenticated.value = true
    password.value = ''
    error.value = ''
    // Keep unsaved edits if a session expired while saving.
    if (!loaded.value) await loadContent()
  } catch (cause) {
    loginError.value = cause instanceof Error ? cause.message : 'Unable to sign in.'
  } finally {
    signingIn.value = false
  }
}

async function signOut() {
  signingOut.value = true
  error.value = ''
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST' })
    if (!response.ok) throw new Error('Unable to sign out. Please try again.')
    authenticated.value = false
    loaded.value = false
    visitedProducts.value = false
    visitedOrders.value = false
    Object.assign(form, { title: '', subtitle: '', story: '' })
    saved.value = ''
    message.value = ''
    loginError.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to sign out.'
  } finally {
    signingOut.value = false
  }
}

async function loadContent() {
  loading.value = true
  error.value = ''
  try {
    Object.assign(form, await requestContent())
    saved.value = JSON.stringify(form)
    loaded.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Unable to load content.'
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  message.value = ''
  try {
    Object.assign(form, await requestContent({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    }))
    saved.value = JSON.stringify(form)
    message.value = 'Changes saved. The front page is updated.'
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 401) {
      authenticated.value = false
      loginError.value = 'Your session expired. Sign in again to save your changes.'
    } else {
      error.value = cause instanceof Error ? cause.message : 'Unable to save changes.'
    }
  } finally {
    saving.value = false
  }
}

async function moveTab(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = tabs.indexOf(activeTab.value)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const tab = tabs[next]!
  await selectTab(tab)
  document.getElementById(`${tab}-tab`)?.focus()
}

onMounted(checkSession)
</script>

<template>
  <div class="site-shell admin-shell">
    <header class="site-header">
      <RouterLink class="brand" to="/" aria-label="Palianytsia Bread home">
        <img class="brand-logo" src="/uploads/paliantsia_horiz.svg" alt="Palianytsia Bread" width="224" height="44" />
      </RouterLink>
      <div class="admin-header-actions">
        <RouterLink to="/">View website</RouterLink>
        <button v-if="authenticated" class="sign-out-button" type="button" :disabled="signingOut || saving" @click="signOut">{{ signingOut ? 'Signing out…' : 'Sign out' }}</button>
      </div>
    </header>
    <main class="admin-main">
      <h1 class="admin-title">Admin</h1>
      <p v-if="checkingSession" role="status">Checking your session…</p>
      <form v-else-if="!authenticated" class="admin-login" @submit.prevent="signIn">
        <p>Enter your admin password to continue.</p>
        <div class="editor-field">
          <label for="admin-password">Admin password</label>
          <input id="admin-password" v-model="password" type="password" autocomplete="current-password" required :disabled="signingIn" />
        </div>
        <p v-if="loginError" class="error-message" role="alert">{{ loginError }}</p>
        <button class="action-button" type="submit" :disabled="signingIn">{{ signingIn ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <template v-else>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <div class="admin-tabs" role="tablist" aria-label="Page editor" @keydown="moveTab">
        <button id="front-tab" type="button" role="tab" :aria-selected="activeTab === 'front'" aria-controls="front-panel" :tabindex="activeTab === 'front' ? 0 : -1" @click="selectTab('front')">Front page</button>
        <button id="products-tab" type="button" role="tab" :aria-selected="activeTab === 'products'" aria-controls="products-panel" :tabindex="activeTab === 'products' ? 0 : -1" @click="selectTab('products')">Products page</button>
        <button id="orders-tab" type="button" role="tab" :aria-selected="activeTab === 'orders'" aria-controls="orders-panel" :tabindex="activeTab === 'orders' ? 0 : -1" @click="selectTab('orders')">Orders</button>
      </div>

      <section v-show="activeTab === 'front'" id="front-panel" role="tabpanel" aria-labelledby="front-tab" tabindex="0">
        <p class="admin-intro">Edit the title, subtitle, and story shown on the front page.</p>
        <p id="html-help" class="admin-help">Use HTML for formatting, such as &lt;span&gt;, &lt;strong&gt;, and &lt;p&gt; for story paragraphs. Scripts, styles, and unsafe attributes are removed when you save.</p>
        <p v-if="loading" role="status">Loading content…</p>
        <button v-if="!loading && !loaded" type="button" class="action-button" @click="loadContent">Try again</button>

        <form v-if="loaded" @submit.prevent="save">
          <fieldset class="editor-fields" :disabled="saving">
            <div v-for="field in contentFields" :key="field" class="editor-field">
              <label :for="`content-${field}`">{{ labels[field] }} <span>HTML</span></label>
              <textarea :id="`content-${field}`" v-model="form[field]" :rows="field === 'story' ? 14 : 3" :maxlength="maxHtmlLength" aria-describedby="html-help" required spellcheck="false" @input="message = ''"></textarea>
            </div>
          </fieldset>
          <div class="editor-actions">
            <button class="action-button" type="submit" :disabled="saving || !dirty">{{ saving ? 'Saving…' : 'Save changes' }}</button>
            <span v-if="dirty && !saving" class="admin-help">Unsaved changes</span>
            <p v-if="message" class="save-message" role="status">{{ message }}</p>
          </div>
        </form>
      </section>

      <section v-show="activeTab === 'products'" id="products-panel" role="tabpanel" aria-labelledby="products-tab" tabindex="0">
        <AdminProducts v-if="visitedProducts || activeTab === 'products'" @unauthorized="sessionExpired" />
      </section>

      <section v-show="activeTab === 'orders'" id="orders-panel" role="tabpanel" aria-labelledby="orders-tab" tabindex="0">
        <AdminOrders v-if="visitedOrders || activeTab === 'orders'" @unauthorized="sessionExpired" />
      </section>
      </template>
    </main>
  </div>
</template>
