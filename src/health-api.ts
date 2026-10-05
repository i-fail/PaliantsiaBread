import type { ServerHealth } from '../shared/health'
import { ApiError } from './content-api'

export async function getServerHealth(): Promise<ServerHealth> {
  const response = await fetch('/api/admin/server-health', { cache: 'no-store' })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error || 'Failed to load server health.', response.status)
  return body as ServerHealth
}
