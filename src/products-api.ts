import type { Product, ProductInput } from '../shared/products'
import { ApiError } from './content-api'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  // Proxies and body-size limits can answer with something other than JSON.
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = response.status === 413 ? 'That file is too large.' : 'Something went wrong. Please try again.'
    throw new ApiError(body?.error || fallback, response.status)
  }
  return body as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listPublicProducts = () => request<Product[]>('/api/products')
export const listAdminProducts = () => request<Product[]>('/api/admin/products')
export const createProduct = (input: ProductInput) => request<Product>('/api/admin/products', json('POST', input))
export const updateProduct = (id: number, input: ProductInput) =>
  request<Product>(`/api/admin/products/${id}`, json('PUT', input))
export const setMainPhoto = (id: number, photoId: number) =>
  request<Product>(`/api/admin/products/${id}/main-photo`, json('PUT', { photoId }))
export const deletePhoto = (id: number, photoId: number) =>
  request<Product>(`/api/admin/products/${id}/photos/${photoId}`, { method: 'DELETE' })

export function uploadPhoto(id: number, file: File) {
  const body = new FormData()
  body.append('photo', file)
  return request<Product>(`/api/admin/products/${id}/photos`, { method: 'POST', body })
}
export const reorderProducts = (ids: number[]) => request<Product[]>('/api/admin/products/order', json('PUT', { ids }))
export const getPublicProduct = (slug: string) => request<Product>(`/api/products/${encodeURIComponent(slug)}`)
