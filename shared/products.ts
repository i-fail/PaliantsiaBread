export interface ProductPhoto {
  id: number
  url: string
  width: number
  height: number
}

export interface Product {
  id: number
  // URL name for the product page at /buy/<slug>; generated from the title when the product is created.
  slug: string
  sku: string
  title: string
  description: string
  enabled: boolean
  // Whole cents in `currency`; null for products that have no price yet.
  priceCents: number | null
  // The photo marked as main, or the first uploaded photo when none is marked.
  mainPhotoId: number | null
  photos: ProductPhoto[]
}

export interface ProductInput {
  sku: string
  title: string
  description: string
  enabled: boolean
  priceCents: number | null
}

export const productLimits = {
  sku: 64,
  title: 200,
  description: 5000,
  photos: 10,
  photoBytes: 10 * 1024 * 1024,
  photoWidth: 800,
} as const

export const skuPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Change this one constant to show prices in another currency (an ISO 4217 code).
export const currency = 'USD'
export const maxPriceCents = 10_000_000

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

// Reads what an admin types ("12", "12.5", "12.50") as whole cents; null when it isn't a valid price above zero.
export function parsePrice(text: string): number | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return cents > 0 && cents <= maxPriceCents ? cents : null
}

export function priceToInput(cents: number): string {
  return (cents / 100).toFixed(2)
}
