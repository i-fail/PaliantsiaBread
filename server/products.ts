import { maxPriceCents, productLimits, skuPattern, type Product, type ProductInput } from '../shared/products'
import { ContentValidationError } from './content'
import { getDatabase } from './db'
import type { ProcessedPhoto } from './photos'
import { slugify, uniqueSlug } from './slug'

export class ProductConflictError extends Error {}

export function cleanProductInput(value: unknown): ProductInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentValidationError('Provide a SKU, title, and description.')
  }
  const source = value as Record<string, unknown>
  const text = (field: 'sku' | 'title' | 'description') => {
    const entry = source[field]
    if (typeof entry !== 'string') throw new ContentValidationError(`${field} must be text.`)
    return entry.trim()
  }

  const sku = text('sku')
  const title = text('title')
  const description = text('description')
  if (!sku || sku.length > productLimits.sku || !skuPattern.test(sku)) {
    throw new ContentValidationError(`SKU must be 1-${productLimits.sku} letters, numbers, dots, dashes, or underscores.`)
  }
  if (!title || title.length > productLimits.title) {
    throw new ContentValidationError(`Title is required and must be at most ${productLimits.title} characters.`)
  }
  if (description.length > productLimits.description) {
    throw new ContentValidationError(`Description must be at most ${productLimits.description} characters.`)
  }
  if (typeof source.enabled !== 'boolean') throw new ContentValidationError('enabled must be true or false.')
  if (typeof source.shippingAvailable !== 'boolean') throw new ContentValidationError('shippingAvailable must be true or false.')
  // The key must be present so a client that doesn't know about prices can't silently clear one.
  const price = source.priceCents
  if (price !== null && (typeof price !== 'number' || !Number.isInteger(price) || price < 1 || price > maxPriceCents)) {
    throw new ContentValidationError('Price must be above zero and a whole number of cents, or null.')
  }
  return { sku, title, description, enabled: source.enabled, priceCents: price as number | null, shippingAvailable: source.shippingAvailable }
}

export function cleanProductOrder(value: unknown): number[] {
  const ids = (value as { ids?: unknown } | null)?.ids
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000
    || !ids.every(id => Number.isSafeInteger(id) && id > 0) || new Set(ids).size !== ids.length) {
    throw new ContentValidationError('Provide each product id exactly once.')
  }
  return ids
}

interface ProductRow { id: number; slug: string; sku: string; title: string; description: string; enabled: boolean; price_cents: number | null; shipping_available: boolean }
interface PhotoRow { id: number; product_id: number; is_main: boolean; width: number; height: number }

export function photoUrl(id: number) {
  return `/api/product-photos/${id}`
}

function toProduct(row: ProductRow, photos: PhotoRow[]): Product {
  const main = photos.find(photo => photo.is_main) ?? photos[0]
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    title: row.title,
    description: row.description,
    enabled: row.enabled,
    priceCents: row.price_cents,
    shippingAvailable: row.shipping_available,
    mainPhotoId: main?.id ?? null,
    photos: photos.map(photo => ({ id: photo.id, url: photoUrl(photo.id), width: photo.width, height: photo.height })),
  }
}

async function loadProducts(rows: ProductRow[]): Promise<Product[]> {
  const db = getDatabase()
  if (!rows.length) return []
  const ids = new Set(rows.map(row => row.id))
  const photos: PhotoRow[] = (await db`SELECT id, product_id, is_main, width, height FROM product_photos ORDER BY id`)
    .filter((photo: PhotoRow) => ids.has(photo.product_id))
  return rows.map(row => toProduct(row, photos.filter(photo => photo.product_id === row.id)))
}

export async function listProducts({ enabledOnly }: { enabledOnly: boolean }): Promise<Product[]> {
  const db = getDatabase()
  const rows: ProductRow[] = enabledOnly
    ? await db`SELECT id, slug, sku, title, description, enabled, price_cents, shipping_available FROM products WHERE enabled ORDER BY position, id`
    : await db`SELECT id, slug, sku, title, description, enabled, price_cents, shipping_available FROM products ORDER BY position, id`
  return loadProducts(rows)
}

export async function getProduct(id: number): Promise<Product | null> {
  const db = getDatabase()
  const rows: ProductRow[] = await db`SELECT id, slug, sku, title, description, enabled, price_cents, shipping_available FROM products WHERE id = ${id}`
  return (await loadProducts(rows))[0] ?? null
}

function constraintOf(error: unknown): string | null {
  return (error as { errno?: string })?.errno === '23505' ? (error as { constraint?: string }).constraint ?? '' : null
}

function rethrowConflict(error: unknown): never {
  if (constraintOf(error) === 'products_sku_key') throw new ProductConflictError('Another product already uses this SKU.')
  throw error
}

export async function getProductBySlug(slug: string, { enabledOnly }: { enabledOnly: boolean }): Promise<Product | null> {
  const db = getDatabase()
  const rows: ProductRow[] = await db`SELECT id, slug, sku, title, description, enabled, price_cents, shipping_available FROM products WHERE slug = ${slug}`
  const row = rows[0]
  return row && (row.enabled || !enabledOnly) ? (await loadProducts([row]))[0] ?? null : null
}

// The slug comes from the title once, at creation, so shared links keep working if the title changes later.
export async function createProduct(input: ProductInput): Promise<Product> {
  const db = getDatabase()
  const base = slugify(input.title)
  // A concurrent create can claim the same slug between the lookup and the insert; look again and retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken: { slug: string }[] = await db`SELECT slug FROM products WHERE slug = ${base} OR slug LIKE ${base + '-%'}`
    const slug = uniqueSlug(base, taken.map(row => row.slug))
    try {
      const [row]: ProductRow[] = await db`
        INSERT INTO products (slug, sku, title, description, enabled, price_cents, shipping_available, position)
        VALUES (${slug}, ${input.sku}, ${input.title}, ${input.description}, ${input.enabled}, ${input.priceCents}, ${input.shippingAvailable},
          (SELECT COALESCE(MAX(position), 0) + 1 FROM products))
        RETURNING id, slug, sku, title, description, enabled, price_cents, shipping_available
      `
      return toProduct(row!, [])
    } catch (error) {
      if (constraintOf(error) === 'products_slug_key') continue
      return rethrowConflict(error)
    }
  }
  throw new Error('Could not generate a unique slug.')
}

export async function updateProduct(id: number, input: ProductInput): Promise<Product | null> {
  const db = getDatabase()
  try {
    const rows: ProductRow[] = await db`
      UPDATE products
      SET sku = ${input.sku}, title = ${input.title}, description = ${input.description},
          enabled = ${input.enabled}, price_cents = ${input.priceCents}, shipping_available = ${input.shippingAvailable}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, slug, sku, title, description, enabled, price_cents, shipping_available
    `
    return (await loadProducts(rows))[0] ?? null
  } catch (error) {
    return rethrowConflict(error)
  }
}

export async function addPhoto(productId: number, photo: ProcessedPhoto): Promise<Product | null> {
  const db = getDatabase()
  const added = await db.begin(async tx => {
    // Locking the product row serializes concurrent uploads so the photo limit holds.
    const [product] = await tx`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`
    if (!product) return false
    const [{ count }] = await tx`SELECT COUNT(*)::int AS count FROM product_photos WHERE product_id = ${productId}`
    if (count >= productLimits.photos) {
      throw new ContentValidationError(`A product can have at most ${productLimits.photos} photos.`)
    }
    await tx`
      INSERT INTO product_photos (product_id, data, width, height)
      VALUES (${productId}, ${photo.data}, ${photo.width}, ${photo.height})
    `
    await tx`UPDATE products SET updated_at = NOW() WHERE id = ${productId}`
    return true
  })
  return added ? getProduct(productId) : null
}

export async function setMainPhoto(productId: number, photoId: number): Promise<Product | null> {
  const db = getDatabase()
  const changed = await db.begin(async tx => {
    const [photo] = await tx`SELECT id FROM product_photos WHERE id = ${photoId} AND product_id = ${productId} FOR UPDATE`
    if (!photo) return false
    await tx`UPDATE product_photos SET is_main = FALSE WHERE product_id = ${productId} AND is_main`
    await tx`UPDATE product_photos SET is_main = TRUE WHERE id = ${photoId}`
    await tx`UPDATE products SET updated_at = NOW() WHERE id = ${productId}`
    return true
  })
  return changed ? getProduct(productId) : null
}

export async function deletePhoto(productId: number, photoId: number): Promise<Product | null> {
  const db = getDatabase()
  const rows = await db`DELETE FROM product_photos WHERE id = ${photoId} AND product_id = ${productId} RETURNING id`
  if (rows.length) await db`UPDATE products SET updated_at = NOW() WHERE id = ${productId}`
  return rows.length ? getProduct(productId) : null
}

export async function readPhoto(id: number): Promise<{ data: Uint8Array; enabled: boolean } | null> {
  const db = getDatabase()
  const [row] = await db`
    SELECT ph.data, p.enabled FROM product_photos ph JOIN products p ON p.id = ph.product_id WHERE ph.id = ${id}
  `
  return row ? { data: row.data, enabled: row.enabled } : null
}

// Replaces the whole display order. The ids must be exactly the current products so a stale list can't drop or reorder unseen ones.
export async function reorderProducts(ids: number[]): Promise<Product[]> {
  const db = getDatabase()
  await db.begin(async tx => {
    const rows: { id: number }[] = await tx`SELECT id FROM products FOR UPDATE`
    if (rows.length !== ids.length || !rows.every(row => ids.includes(row.id))) {
      throw new ProductConflictError('The product list has changed. Reload the page and try again.')
    }
    for (const [index, id] of ids.entries()) {
      await tx`UPDATE products SET position = ${index + 1} WHERE id = ${id}`
    }
  })
  return listProducts({ enabledOnly: false })
}
