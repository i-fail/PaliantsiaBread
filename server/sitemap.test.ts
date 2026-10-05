import { describe, expect, spyOn, test } from 'bun:test'
import {
  buildSitemap, createSitemapHandler, maxSitemapUrls, sitemapBaseUrl, sitemapEntries, type SitemapSources,
} from './sitemap'

const date = (iso: string) => new Date(iso)
const locs = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1])

describe('building the sitemap XML', () => {
  test('is a urlset in the standard namespace with one url per entry', () => {
    const xml = buildSitemap('https://shop.example.com', [{ path: '/' }, { path: '/contact' }])
    expect(xml).toBe([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url>',
      '    <loc>https://shop.example.com/</loc>',
      '  </url>',
      '  <url>',
      '    <loc>https://shop.example.com/contact</loc>',
      '  </url>',
      '</urlset>',
      '',
    ].join('\n'))
  })

  test('adds a last-modified time when one is known, and leaves it out otherwise', () => {
    const xml = buildSitemap('https://shop.example.com', [
      { path: '/buy', lastModified: date('2026-10-05T12:30:00.000Z') },
      { path: '/contact', lastModified: null },
      { path: '/x' },
    ])
    expect(xml).toContain('<loc>https://shop.example.com/buy</loc>\n    <lastmod>2026-10-05T12:30:00.000Z</lastmod>')
    expect(xml.match(/<lastmod>/g)).toHaveLength(1)
  })

  test('ignores an invalid date instead of writing "Invalid Date"', () => {
    const xml = buildSitemap('https://shop.example.com', [{ path: '/buy', lastModified: new Date('garbage') }])
    expect(xml).not.toContain('lastmod')
    expect(xml).not.toContain('Invalid')
  })

  test('copes with a trailing slash on the base address', () => {
    for (const base of ['https://shop.example.com/', 'https://shop.example.com///']) {
      expect(locs(buildSitemap(base, [{ path: '/buy' }]))).toEqual(['https://shop.example.com/buy'])
    }
  })

  test('escapes characters that are special in XML', () => {
    const xml = buildSitemap('https://shop.example.com', [{ path: '/search?a=1&b=<2>"x"\'y\'' }])
    expect(xml).toContain('<loc>https://shop.example.com/search?a=1&amp;b=&lt;2&gt;&quot;x&quot;&apos;y&apos;</loc>')
    expect(xml).not.toMatch(/&b=|<2>/)
  })

  test('an empty list is still a valid (empty) sitemap', () => {
    expect(buildSitemap('https://shop.example.com', [])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n</urlset>\n')
  })

  test('never lists more than the 50,000 addresses a sitemap may hold', () => {
    const entries = Array.from({ length: maxSitemapUrls + 25 }, (_, index) => ({ path: `/buy/p${index}` }))
    expect(locs(buildSitemap('https://s.example.com', entries))).toHaveLength(maxSitemapUrls)
  })
})

describe('which pages are listed', () => {
  const sources: SitemapSources = {
    homeUpdatedAt: date('2026-09-01T10:00:00.000Z'),
    products: [
      { slug: 'rye-loaf', updatedAt: date('2026-10-01T10:00:00.000Z') },
      { slug: 'old-world-chornobaivsky-dark-rye', updatedAt: date('2026-10-04T09:00:00.000Z') },
      { slug: 'cake', updatedAt: date('2026-08-15T09:00:00.000Z') },
    ],
  }

  test('the home page, contact, buy, then every product page in display order', () => {
    expect(sitemapEntries(sources).map(entry => entry.path)).toEqual([
      '/', '/contact', '/buy', '/buy/rye-loaf', '/buy/old-world-chornobaivsky-dark-rye', '/buy/cake',
    ])
  })

  test('only public pages: never checkout, orders, or the admin', () => {
    const paths = sitemapEntries(sources).map(entry => entry.path)
    for (const path of paths) expect(path).not.toMatch(/checkout|order|admin|api|cart/)
  })

  test('last-modified times: the home page by its text, products by their own edits, buy by the newest product', () => {
    const entries = Object.fromEntries(sitemapEntries(sources).map(entry => [entry.path, entry.lastModified?.toISOString() ?? null]))
    expect(entries['/']).toBe('2026-09-01T10:00:00.000Z')
    expect(entries['/contact']).toBeNull()
    expect(entries['/buy']).toBe('2026-10-04T09:00:00.000Z')
    expect(entries['/buy/rye-loaf']).toBe('2026-10-01T10:00:00.000Z')
    expect(entries['/buy/cake']).toBe('2026-08-15T09:00:00.000Z')
  })

  test('with no products the three fixed pages are still listed', () => {
    const entries = sitemapEntries({ products: [], homeUpdatedAt: null })
    expect(entries.map(entry => entry.path)).toEqual(['/', '/contact', '/buy'])
    expect(entries.every(entry => !entry.lastModified)).toBe(true)
  })

  test('slugs are written safely into the address', () => {
    const paths = sitemapEntries({ products: [{ slug: 'a b/c?d', updatedAt: date('2026-10-01T00:00:00Z') }], homeUpdatedAt: null }).map(entry => entry.path)
    expect(paths).toContain('/buy/a%20b%2Fc%3Fd')
  })
})

describe('which address the sitemap uses for the site', () => {
  const request = (url = 'http://localhost:3001/sitemap.xml', headers: Record<string, string> = {}) => new Request(url, { headers })

  test('SITE_URL, when set, is the canonical address (without any path or trailing slash)', () => {
    expect(sitemapBaseUrl('https://palianytsiabread.com', request())).toBe('https://palianytsiabread.com')
    expect(sitemapBaseUrl('https://palianytsiabread.com/', request())).toBe('https://palianytsiabread.com')
    expect(sitemapBaseUrl(' https://palianytsiabread.com/shop/ ', request())).toBe('https://palianytsiabread.com')
    expect(sitemapBaseUrl('http://127.0.0.1:5173', request())).toBe('http://127.0.0.1:5173')
  })

  test('without SITE_URL, the address the request arrived on is used', () => {
    expect(sitemapBaseUrl(undefined, request('http://localhost:3001/sitemap.xml'))).toBe('http://localhost:3001')
    expect(sitemapBaseUrl('', request('http://localhost:3001/sitemap.xml'))).toBe('http://localhost:3001')
  })

  test('behind nginx, the forwarded scheme is respected', () => {
    expect(sitemapBaseUrl(undefined, request('http://palianytsiabread.com/sitemap.xml', { 'X-Forwarded-Proto': 'https' }))).toBe('https://palianytsiabread.com')
    expect(sitemapBaseUrl(undefined, request('http://palianytsiabread.com/sitemap.xml', { 'X-Forwarded-Proto': 'https, http' }))).toBe('https://palianytsiabread.com')
  })

  test('an unexpected forwarded scheme is ignored', () => {
    expect(sitemapBaseUrl(undefined, request('http://shop.example.com/sitemap.xml', { 'X-Forwarded-Proto': 'javascript' }))).toBe('http://shop.example.com')
  })

  test('an unusable SITE_URL falls back instead of producing nonsense', () => {
    for (const bad of ['not a url', 'ftp://example.com', 'javascript:alert(1)']) {
      expect(sitemapBaseUrl(bad, request('http://localhost:3001/sitemap.xml'))).toBe('http://localhost:3001')
    }
  })
})

describe('the /sitemap.xml response', () => {
  const sources: SitemapSources = { homeUpdatedAt: null, products: [{ slug: 'rye-loaf', updatedAt: date('2026-10-01T10:00:00.000Z') }] }
  const request = () => new Request('http://localhost:3001/sitemap.xml')

  test('is XML, briefly cacheable, and lists the pages under the site address', async () => {
    const response = await createSitemapHandler({ load: async () => sources, siteUrl: 'https://palianytsiabread.com' })(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    const xml = await response.text()
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(locs(xml)).toEqual([
      'https://palianytsiabread.com/', 'https://palianytsiabread.com/contact', 'https://palianytsiabread.com/buy', 'https://palianytsiabread.com/buy/rye-loaf',
    ])
  })

  test('reads the current products every time it is asked', async () => {
    let calls = 0
    const handler = createSitemapHandler({
      load: async () => ({ homeUpdatedAt: null, products: calls++ === 0 ? [] : sources.products }),
      siteUrl: 'https://palianytsiabread.com',
    })
    expect(locs(await (await handler(request())).text())).toHaveLength(3)
    expect(locs(await (await handler(request())).text())).toHaveLength(4)
  })

  test('if the database is down it answers 503 with a retry hint, and says nothing about why', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const response = await createSitemapHandler({ load: async () => { throw new Error('connection to db.internal refused') } })(request())
      expect(response.status).toBe(503)
      expect(response.headers.get('Retry-After')).toBe('300')
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.text()).not.toContain('db.internal')
    } finally {
      spy.mockRestore()
    }
  })
})
