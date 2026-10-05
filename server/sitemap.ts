import { getDatabase } from './db'

// A sitemap lists at most 50,000 addresses (sitemaps.org); a shop this size will never get near it.
export const maxSitemapUrls = 50_000

export interface SitemapEntry {
  // The path on the site, starting with "/".
  path: string
  lastModified?: Date | null
}

const escapeXml = (text: string) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

export function buildSitemap(baseUrl: string, entries: SitemapEntry[]): string {
  const base = baseUrl.replace(/\/+$/, '')
  const urls = entries.slice(0, maxSitemapUrls).map(entry => {
    const lastModified = entry.lastModified && Number.isFinite(entry.lastModified.getTime())
      ? `\n    <lastmod>${entry.lastModified.toISOString()}</lastmod>`
      : ''
    return `  <url>\n    <loc>${escapeXml(base + entry.path)}</loc>${lastModified}\n  </url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}

export interface SitemapSources {
  // The products that are shown on the buy page (enabled ones), in display order.
  products: { slug: string; updatedAt: Date }[]
  // When the front page text was last edited.
  homeUpdatedAt: Date | null
}

const latest = (dates: Date[]) => dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null

// The pages worth listing: the public ones. Checkout, orders (private links) and the admin are left out on purpose.
export function sitemapEntries({ products, homeUpdatedAt }: SitemapSources): SitemapEntry[] {
  return [
    { path: '/', lastModified: homeUpdatedAt },
    { path: '/contact' },
    { path: '/buy', lastModified: latest(products.map(product => product.updatedAt)) },
    ...products.map(product => ({ path: `/buy/${encodeURIComponent(product.slug)}`, lastModified: product.updatedAt })),
  ]
}

export async function loadSitemapSources(): Promise<SitemapSources> {
  const db = getDatabase()
  const [products, home] = await Promise.all([
    db`SELECT slug, updated_at FROM products WHERE enabled ORDER BY position, id`,
    db`SELECT updated_at FROM front_page_content WHERE id = 1`,
  ])
  return {
    products: products.map((row: { slug: string; updated_at: Date }) => ({ slug: row.slug, updatedAt: new Date(row.updated_at) })),
    homeUpdatedAt: home[0] ? new Date(home[0].updated_at) : null,
  }
}

// The address the site is known by. SITE_URL is the canonical one (and is used when set); without it, whatever
// address the request came in on is used, which is convenient while developing.
export function sitemapBaseUrl(siteUrl: string | undefined, request: Request): string {
  const configured = siteUrl?.trim().replace(/\/+$/, '')
  if (configured) {
    try {
      const parsed = new URL(configured)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin
    } catch {
      // Fall through to the request's own address.
    }
  }
  const url = new URL(request.url)
  const forwarded = request.headers.get('X-Forwarded-Proto')?.split(',')[0]?.trim()
  return `${forwarded === 'https' || forwarded === 'http' ? forwarded : url.protocol.replace(':', '')}://${url.host}`
}

export function createSitemapHandler({ load = loadSitemapSources, siteUrl }: { load?: () => Promise<SitemapSources>; siteUrl?: string } = {}) {
  return async (request: Request): Promise<Response> => {
    try {
      const xml = buildSitemap(sitemapBaseUrl(siteUrl, request), sitemapEntries(await load()))
      return new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          // Crawlers fetch this often; a few minutes of caching spares the database without making changes slow to appear.
          'Cache-Control': 'public, max-age=300',
        },
      })
    } catch (error) {
      console.error('Building the sitemap failed:', error instanceof Error ? error.message : 'Unknown error')
      return new Response('The sitemap is temporarily unavailable.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '300', 'Cache-Control': 'no-store' },
      })
    }
  }
}
