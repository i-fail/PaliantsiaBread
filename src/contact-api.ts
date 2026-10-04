import type { ContactMessage } from '../shared/contact'
import { ApiError } from './content-api'

export async function sendContactMessage(message: ContactMessage & { website: string }): Promise<void> {
  const response = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
  if (response.ok) return
  const body = await response.json().catch(() => null)
  throw new ApiError(body?.error || 'We couldn’t send your message right now. Please try again later or call us.', response.status)
}
