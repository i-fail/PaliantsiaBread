import type { FrontPageContent } from '../shared/content'

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

export async function requestContent(options?: RequestInit): Promise<FrontPageContent> {
  const response = await fetch('/api/front-page', { cache: 'no-store', ...options })
  const body = await response.json()
  if (!response.ok) throw new ApiError(body.error || 'Unable to load content.', response.status)
  return body as FrontPageContent
}
