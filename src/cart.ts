import { computed, ref } from 'vue'

export type Delivery = 'ship' | 'pickup'

export interface CartItem {
  productId: number
  quantity: number
  // Only matters for products that can be shipped; products without shipping are always picked up.
  delivery: Delivery
}

const storageKey = 'palianytsia-cart'
export const maxQuantity = 99

// The cart is kept in this browser only. Storage can be missing or blocked, so every access is guarded.
function load(): CartItem[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    if (!Array.isArray(stored)) return []
    return stored.filter((item): item is Omit<CartItem, 'delivery'> & { delivery?: unknown } =>
      Number.isInteger(item?.productId) && item.productId > 0
      && Number.isInteger(item?.quantity) && item.quantity > 0)
      .map(item => ({
        productId: item.productId,
        quantity: Math.min(item.quantity, maxQuantity),
        // Carts saved before this choice existed ship by default.
        delivery: item.delivery === 'pickup' ? 'pickup' as const : 'ship' as const,
      }))
  } catch {
    return []
  }
}

const items = ref<CartItem[]>(load())

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items.value))
  } catch {
    // The cart still works for this visit even if it cannot be remembered.
  }
}

export const cartItems = computed(() => items.value)
export const cartCount = computed(() => items.value.reduce((total, item) => total + item.quantity, 0))

export function addToCart(productId: number) {
  const existing = items.value.find(item => item.productId === productId)
  if (existing) existing.quantity = Math.min(existing.quantity + 1, maxQuantity)
  else items.value.push({ productId, quantity: 1, delivery: 'ship' })
  save()
}

// Sets a line's quantity, kept between 1 and the maximum. Removing a line is a separate action.
export function setQuantity(productId: number, quantity: number) {
  const existing = items.value.find(item => item.productId === productId)
  if (!existing || !Number.isFinite(quantity)) return
  existing.quantity = Math.min(Math.max(Math.trunc(quantity), 1), maxQuantity)
  save()
}

export function setDelivery(productId: number, delivery: Delivery) {
  const existing = items.value.find(item => item.productId === productId)
  if (!existing) return
  existing.delivery = delivery
  save()
}

export function removeFromCart(productId: number) {
  items.value = items.value.filter(item => item.productId !== productId)
  save()
}

// Keep several open tabs in step.
window.addEventListener('storage', event => {
  if (event.key === storageKey) items.value = load()
})
