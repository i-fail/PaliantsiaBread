import type { OrderDetails, OrderRequest, OrderSummary, PlacedOrder } from '../shared/orders'
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
export const getOrderDetails = (slug: string) => adminRequest<OrderDetails>(`/api/admin/orders/${encodeURIComponent(slug)}`)
