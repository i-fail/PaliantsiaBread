import type { OrderDetails, OrderRequest, OrderStatus, OrderSummary, PlacedOrder } from '../shared/orders'
import { ApiError } from './content-api'

export async function placeOrder(order: OrderRequest): Promise<PlacedOrder> {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(body?.error || 'We couldn’t place your order right now. Please try again or call us.', response.status)
  }
  return body as PlacedOrder
}

async function adminRequest<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = response.status === 404 ? 'Order not found.' : 'Something went wrong. Please try again.'
    throw new ApiError(body?.error || fallback, response.status)
  }
  return body as T
}

export const listOrders = () => adminRequest<OrderSummary[]>('/api/admin/orders')
// Reading one order needs no login: anyone with its link can see it.
export async function getOrderDetails(slug: string): Promise<OrderDetails> {
  const response = await fetch(`/api/orders/${encodeURIComponent(slug)}`, { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const fallback = response.status === 404 ? 'Order not found.' : 'Something went wrong. Please try again.'
    throw new ApiError(body?.error || fallback, response.status)
  }
  return body as OrderDetails
}

// Whether the visitor is signed in as an admin. Anything unexpected means "not an admin".
export async function isAdminSession(): Promise<boolean> {
  try {
    const response = await fetch('/api/admin/session', { cache: 'no-store' })
    return response.ok && (await response.json()).authenticated === true
  } catch {
    return false
  }
}

export async function updateOrderStatus(slug: string, status: OrderStatus): Promise<OrderDetails> {
  const response = await fetch(`/api/admin/orders/${encodeURIComponent(slug)}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error || 'Unable to change the status. Please try again.', response.status)
  return body as OrderDetails
}
