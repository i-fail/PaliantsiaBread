import { orderLimits, phoneLimits, stateCodes } from '../shared/orders'

// What the buyer types on the checkout page. It is remembered in this browser so it need not be typed again.
export interface BuyerDetails {
  email: string
  phone: string
  name: string
  street: string
  city: string
  state: string
  zip: string
}

const storageKey = 'palianytsia-checkout'

// The longest each field may be; these match the maximum lengths of the checkout form's inputs.
const maxLength: Record<keyof BuyerDetails, number> = {
  email: orderLimits.email, phone: phoneLimits.maxLength, name: orderLimits.name, street: orderLimits.street, city: orderLimits.city, state: 2, zip: 10,
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

// Browser storage can be missing or blocked (private windows, strict settings), so it is optional everywhere.
function browserStore(): Store | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function emptyBuyer(): BuyerDetails {
  return { email: '', phone: '', name: '', street: '', city: '', state: '', zip: '' }
}

// Saved data is never trusted: anything unreadable, of the wrong type, or too long is ignored, and a saved
// state is kept only if it is one we ship to.
export function loadBuyer(store: Store | null = browserStore()): BuyerDetails {
  const buyer = emptyBuyer()
  try {
    const saved: unknown = JSON.parse(store?.getItem(storageKey) ?? 'null')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return buyer
    for (const field of Object.keys(buyer) as (keyof BuyerDetails)[]) {
      const value = (saved as Record<string, unknown>)[field]
      if (typeof value === 'string') buyer[field] = value.slice(0, maxLength[field])
    }
    if (!stateCodes.has(buyer.state)) buyer.state = ''
  } catch {
    return emptyBuyer()
  }
  return buyer
}

export function saveBuyer(buyer: BuyerDetails, store: Store | null = browserStore()) {
  try {
    store?.setItem(storageKey, JSON.stringify(buyer))
  } catch {
    // The checkout still works; the details just will not be remembered.
  }
}
