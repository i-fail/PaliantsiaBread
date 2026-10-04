<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { currency, formatPrice, parsePrice, priceToInput, productLimits, type Product } from '../shared/products'
import { ApiError } from './content-api'
import * as api from './products-api'

const emit = defineEmits<{ unauthorized: [] }>()

const products = ref<Product[]>([])
const loading = ref(true)
const loaded = ref(false)
const error = ref('')
const message = ref('')
const selected = ref<number | 'new' | null>(null)
// The price is kept as typed ("12.50") and converted to whole cents when saving.
const form = reactive({ sku: '', title: '', description: '', enabled: true, shippingAvailable: false, price: '' })
const saved = ref('')
const saving = ref(false)
const busy = ref(false)
const uploadStatus = ref('')
const moveNote = ref('')
const dragId = ref<number | null>(null)
const overId = ref<number | null>(null)

// A SKU must contain at least one letter or number.
const skuValid = computed(() => /[A-Za-z0-9]/.test(form.sku))
const priceCents = computed(() => parsePrice(form.price))
const priceInvalid = computed(() => form.price.trim() !== '' && priceCents.value === null)
const dirty = computed(() => selected.value !== null && JSON.stringify(form) !== saved.value)
const current = computed(() => typeof selected.value === 'number' ? products.value.find(p => p.id === selected.value) ?? null : null)

function fail(cause: unknown, fallback: string) {
  if (cause instanceof ApiError && cause.status === 401) {
    emit('unauthorized')
    return
  }
  error.value = cause instanceof Error ? cause.message : fallback
}

function replace(product: Product) {
  const index = products.value.findIndex(p => p.id === product.id)
  if (index >= 0) products.value[index] = product
  else products.value.push(product)
}

function fill(product: Product | null) {
  Object.assign(form, product
    ? { sku: product.sku, title: product.title, description: product.description, enabled: product.enabled, shippingAvailable: product.shippingAvailable, price: product.priceCents === null ? '' : priceToInput(product.priceCents) }
    : { sku: '', title: '', description: '', enabled: true, shippingAvailable: false, price: '' })
  saved.value = JSON.stringify(form)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    products.value = await api.listAdminProducts()
    loaded.value = true
  } catch (cause) {
    fail(cause, 'Unable to load products.')
  } finally {
    loading.value = false
  }
}

function edit(product: Product | null) {
  selected.value = product ? product.id : 'new'
  fill(product)
  error.value = ''
  message.value = ''
  uploadStatus.value = ''
}

function close() {
  selected.value = null
  message.value = ''
  error.value = ''
}

async function save() {
  error.value = ''
  message.value = ''
  const sku = form.sku.trim().toLowerCase()
  if (!sku) {
    error.value = 'Enter a SKU.'
    return
  }
  // The server enforces this too; checking here avoids a round trip for the common case.
  if (products.value.some(p => p.id !== current.value?.id && p.sku.toLowerCase() === sku)) {
    error.value = 'Another product already uses this SKU.'
    return
  }
  saving.value = true
  try {
    const { price: _typed, ...fields } = form
    const input = { ...fields, priceCents: priceCents.value }
    const product = current.value ? await api.updateProduct(current.value.id, input) : await api.createProduct(input)
    replace(product)
    selected.value = product.id
    fill(product)
    message.value = 'Product saved.'
  } catch (cause) {
    fail(cause, 'Unable to save the product.')
  } finally {
    saving.value = false
  }
}

async function toggle(product: Product) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const { sku, title, description, priceCents, shippingAvailable } = product
    replace(await api.updateProduct(product.id, { sku, title, description, enabled: !product.enabled, priceCents, shippingAvailable }))
    if (selected.value === product.id) {
      // Reflect the new state in the open form without touching other unsaved edits.
      form.enabled = !product.enabled
      saved.value = JSON.stringify({ ...JSON.parse(saved.value), enabled: form.enabled })
    }
  } catch (cause) {
    fail(cause, 'Unable to update the product.')
  } finally {
    busy.value = false
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  const product = current.value
  if (!product || !files.length) return

  busy.value = true
  error.value = ''
  message.value = ''
  const failures: string[] = []
  for (const [index, file] of files.entries()) {
    uploadStatus.value = `Uploading ${index + 1} of ${files.length}…`
    if (file.size > productLimits.photoBytes) {
      failures.push(`${file.name}: files must be 10 MB or smaller.`)
      continue
    }
    try {
      replace(await api.uploadPhoto(product.id, file))
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        emit('unauthorized')
        break
      }
      failures.push(`${file.name}: ${cause instanceof Error ? cause.message : 'upload failed.'}`)
    }
  }
  uploadStatus.value = ''
  if (failures.length) error.value = failures.join(' ')
  busy.value = false
}

async function photoAction(action: () => Promise<Product>, fallback: string) {
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    replace(await action())
  } catch (cause) {
    fail(cause, fallback)
  } finally {
    busy.value = false
  }
}

const makeMain = (product: Product, photoId: number) =>
  photoAction(() => api.setMainPhoto(product.id, photoId), 'Unable to change the main photo.')

function removePhoto(product: Product, photoId: number) {
  if (!window.confirm('Remove this photo from the product?')) return
  return photoAction(() => api.deletePhoto(product.id, photoId), 'Unable to remove the photo.')
}

const mainPhoto = (product: Product) => product.photos.find(photo => photo.id === product.mainPhotoId)

// Moves a product to a new index, showing the result immediately and restoring the old order if saving fails.
async function moveTo(id: number, target: number) {
  const before = products.value
  const from = before.findIndex(p => p.id === id)
  if (busy.value || saving.value || from < 0 || target < 0 || target >= before.length || target === from) return

  const next = [...before]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved!)
  products.value = next
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const saved = await api.reorderProducts(next.map(p => p.id))
    // Keep any in-progress edit; the server only changed the order.
    products.value = saved
    moveNote.value = `${moved!.title} moved to position ${target + 1} of ${next.length}.`
  } catch (cause) {
    products.value = before
    moveNote.value = ''
    fail(cause, 'Unable to reorder the products.')
  } finally {
    busy.value = false
  }
}

function dragStart(event: DragEvent, product: Product) {
  if (busy.value || saving.value) return event.preventDefault()
  dragId.value = product.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(product.id))
  }
}

function dragOver(event: DragEvent, product: Product) {
  if (dragId.value === null) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  overId.value = product.id
}

function drop(event: DragEvent, product: Product) {
  if (dragId.value === null) return
  event.preventDefault()
  const id = dragId.value
  dragEnd()
  void moveTo(id, products.value.findIndex(p => p.id === product.id))
}

function dragEnd() {
  dragId.value = null
  overId.value = null
}

// Shows where the dragged row will land: before the target when moving up, after it when moving down.
function dropEdge(product: Product) {
  if (dragId.value === null || overId.value !== product.id || dragId.value === product.id) return ''
  const from = products.value.findIndex(p => p.id === dragId.value)
  return from > products.value.findIndex(p => p.id === product.id) ? 'drop-before' : 'drop-after'
}

onMounted(load)
</script>

<template>
  <div class="products-admin">
    <div class="products-heading">
      <button v-if="loaded" class="action-button" type="button" :disabled="saving || busy" @click="edit(null)">Add product</button>
    </div>

    <p v-if="loading" role="status">Loading products…</p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <button v-if="!loading && !loaded" type="button" class="action-button" @click="load">Try again</button>

    <p v-if="loaded && !products.length && selected !== 'new'" class="admin-help">No products yet. Choose “Add product” to create the first one.</p>

    <div class="sr-only" aria-live="polite">{{ moveNote }}</div>
    <ul v-if="products.length" class="product-list" aria-label="Products">
      <li
        v-for="(product, index) in products"
        :key="product.id"
        class="product-row"
        :class="[{ 'is-disabled': !product.enabled, 'is-selected': selected === product.id, 'is-dragging': dragId === product.id }, dropEdge(product)]"
        :draggable="products.length > 1 && !busy && !saving"
        @dragstart="dragStart($event, product)"
        @dragover="dragOver($event, product)"
        @drop="drop($event, product)"
        @dragend="dragEnd"
      >
        <span v-if="products.length > 1" class="drag-handle" aria-hidden="true">⠿</span>
        <div class="product-thumb">
          <img v-if="mainPhoto(product)" :src="mainPhoto(product)!.url" alt="" width="64" height="64" />
        </div>
        <div class="product-summary">
          <strong>{{ product.title }}</strong>
          <span class="admin-help">SKU {{ product.sku }} · {{ product.priceCents === null ? 'No price' : formatPrice(product.priceCents) }}</span>
        </div>
        <div class="product-actions">
          <button class="sign-out-button move-button" type="button" :aria-label="`Move ${product.title} up`" :disabled="saving || busy || index === 0" @click="moveTo(product.id, index - 1)">↑</button>
          <button class="sign-out-button move-button" type="button" :aria-label="`Move ${product.title} down`" :disabled="saving || busy || index === products.length - 1" @click="moveTo(product.id, index + 1)">↓</button>
          <button class="sign-out-button" type="button" :aria-label="`Edit ${product.title}`" :disabled="saving || busy" @click="edit(product)">✎ Edit</button>
          <button class="sign-out-button" :class="product.enabled ? 'disable-button' : 'enable-button'" type="button" :aria-label="`${product.enabled ? 'Disable' : 'Enable'} ${product.title}`" :disabled="saving || busy" @click="toggle(product)">{{ product.enabled ? 'Disable' : 'Enable' }}</button>
        </div>
      </li>
    </ul>

    <section v-if="selected !== null" class="product-editor" aria-labelledby="product-editor-title">
      <h2 id="product-editor-title">{{ current ? 'Edit product' : 'New product' }}</h2>
      <p v-if="current" class="admin-help product-slug">
        Page: <RouterLink :to="`/buy/${current.slug}`" target="_blank">/buy/{{ current.slug }}</RouterLink>
        <span v-if="!current.enabled">(disabled — not visible to visitors)</span>
      </p>
      <p v-else class="admin-help product-slug">The page address is generated from the title when the product is created.</p>
      <form @submit.prevent="save">
        <fieldset class="editor-fields" :disabled="saving">
          <div class="editor-field">
            <label for="product-sku">SKU</label>
            <input id="product-sku" v-model="form.sku" required :maxlength="productLimits.sku" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" title="Letters, numbers, dots, dashes, and underscores" autocomplete="off" @input="message = ''" />
          </div>
          <div class="editor-field">
            <label for="product-title">Title</label>
            <input id="product-title" v-model="form.title" required :maxlength="productLimits.title" @input="message = ''" />
          </div>
          <div class="editor-field">
            <label for="product-price">Price <span>{{ currency }}</span></label>
            <input id="product-price" v-model="form.price" required inputmode="decimal" autocomplete="off" placeholder="0.00" :aria-invalid="priceInvalid" aria-describedby="product-price-help" @input="message = ''" />
            <p id="product-price-help" class="admin-help" :class="{ 'error-message': priceInvalid }">Enter an amount above zero, such as 12.50.</p>
          </div>
          <div class="editor-field">
            <label for="product-description">Description</label>
            <textarea id="product-description" v-model="form.description" rows="6" :maxlength="productLimits.description" @input="message = ''"></textarea>
          </div>
          <label class="checkbox-field"><input v-model="form.enabled" type="checkbox" @change="message = ''" /> Enabled — show on the buy page</label>
          <label class="checkbox-field"><input v-model="form.shippingAvailable" type="checkbox" @change="message = ''" /> Shipping available</label>
        </fieldset>
        <div class="editor-actions">
          <button class="action-button" type="submit" :disabled="saving || !dirty || !skuValid || priceCents === null">{{ saving ? 'Saving…' : current ? 'Save product' : 'Create product' }}</button>
          <button class="sign-out-button" type="button" :disabled="saving" @click="close">{{ dirty ? 'Discard and close' : 'Close' }}</button>
          <span v-if="dirty && !saving" class="admin-help">Unsaved changes</span>
          <p v-if="message" class="save-message" role="status">{{ message }}</p>
        </div>
      </form>

      <div class="photo-manager">
        <h3>Photos</h3>
        <p v-if="!current" class="admin-help">Create the product first, then add photos.</p>
        <template v-else>
          <p class="admin-help">Photos are resized to {{ productLimits.photoWidth }}px wide and converted to WebP. The main photo is shown first; by default that is the first photo uploaded. Up to {{ productLimits.photos }} photos.</p>
          <ul v-if="current.photos.length" class="photo-grid" aria-label="Product photos">
            <li v-for="(photo, index) in current.photos" :key="photo.id">
              <img :src="photo.url" :alt="`${current.title} photo ${index + 1}`" :width="photo.width" :height="photo.height" />
              <div class="photo-actions">
                <span v-if="photo.id === current.mainPhotoId" class="main-photo-label">Main photo</span>
                <button v-else class="sign-out-button" type="button" :disabled="busy" @click="makeMain(current, photo.id)">Make main</button>
                <button class="sign-out-button" type="button" :disabled="busy" :aria-label="`Remove photo ${index + 1}`" @click="removePhoto(current, photo.id)">Remove</button>
              </div>
            </li>
          </ul>
          <div class="editor-field">
            <label for="product-photos">Add photos</label>
            <input id="product-photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple :disabled="busy || current.photos.length >= productLimits.photos" @change="upload" />
          </div>
          <p v-if="uploadStatus" role="status">{{ uploadStatus }}</p>
        </template>
      </div>
    </section>
  </div>
</template>
