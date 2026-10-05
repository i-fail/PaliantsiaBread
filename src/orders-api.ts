import type { OrderRequest, PlacedOrder } from '../shared/orders'
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
