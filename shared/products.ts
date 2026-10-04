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
  // The photo marked as main, or the first uploaded photo when none is marked.
  mainPhotoId: number | null
  photos: ProductPhoto[]
}

export interface ProductInput {
  sku: string
  title: string
  description: string
  enabled: boolean
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
