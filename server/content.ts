import sanitizeHtml from 'sanitize-html'
import { contentFields, maxHtmlLength, type FrontPageContent } from '../shared/content'
import { getDatabase } from './db'

export class ContentValidationError extends Error {}

export function cleanContent(value: unknown): FrontPageContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContentValidationError('Provide a title, subtitle, and story.')
  }

  const source = value as Record<string, unknown>
  const result = {} as FrontPageContent
  for (const field of contentFields) {
    const html = source[field]
    if (typeof html !== 'string' || html.length > maxHtmlLength) {
      throw new ContentValidationError(`${field} must be HTML text of at most ${maxHtmlLength} characters.`)
    }
    const cleaned = sanitizeHtml(html, {
      allowedTags: field === 'story'
        ? ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'a', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3']
        : ['br', 'strong', 'b', 'em', 'i', 'u', 's', 'span', 'a'],
      allowedAttributes: { a: ['href', 'title'] },
      allowedSchemes: ['http', 'https', 'mailto'],
      allowProtocolRelative: false,
    }).trim()
    const text = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} })
    if (!text.replace(/&nbsp;|&#160;/g, ' ').trim()) {
      throw new ContentValidationError(`${field} must contain visible text.`)
    }
    result[field] = cleaned
  }
  return result
}

export async function readContent(): Promise<FrontPageContent> {
  const db = getDatabase()
  const [row] = await db`SELECT title, subtitle, story FROM front_page_content WHERE id = 1`
  if (!row) throw new Error('Front page content is missing. Run bun run db:migrate.')
  return cleanContent(row)
}

export async function saveContent(content: FrontPageContent): Promise<FrontPageContent> {
  const db = getDatabase()
  const [row] = await db`
    UPDATE front_page_content
    SET title = ${content.title}, subtitle = ${content.subtitle}, story = ${content.story}, updated_at = NOW()
    WHERE id = 1
    RETURNING title, subtitle, story
  `
  if (!row) throw new Error('Front page content is missing. Run bun run db:migrate.')
  return cleanContent(row)
}
