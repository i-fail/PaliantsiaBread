import { productLimits } from '../shared/products'
import { createAdminAuth } from './auth'
import { cleanContent, ContentValidationError, readContent, saveContent } from './content'
import { processPhoto } from './photos'
import { maxSlugLength, slugPattern } from './slug'
import {
  addPhoto, cleanProductInput, cleanProductOrder, createProduct, deletePhoto, getProduct, getProductBySlug, listProducts, ProductConflictError,
  readPhoto, reorderProducts, setMainPhoto, updateProduct,
} from './products'

const maxJsonLength = 1024 * 1024

const adminAuth = createAdminAuth({
  password: process.env.ADMIN_PASSWORD,
  secureCookies: process.env.NODE_ENV === 'production',
})

function contentUnavailable(error: unknown): Response {
  console.error('Front page content request failed:', error instanceof Error ? error.message : 'Unknown error')
  return Response.json({ error: 'Content is temporarily unavailable. Please try again.' }, { status: 503 })
}

function productsUnavailable(error: unknown): Response {
  console.error('Product request failed:', error instanceof Error ? error.message : 'Unknown error')
  return Response.json({ error: 'Products are temporarily unavailable. Please try again.' }, { status: 503 })
}

function isJson(request: Request) {
  return request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') === true
}

// The server accepts photo-sized bodies, so JSON bodies are capped separately.
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > maxJsonLength) throw new ContentValidationError('Request is too large.')
  return JSON.parse(text)
}

function parseId(value: string | undefined): number | null {
  return value && /^\d{1,9}$/.test(value) ? Number(value) : null
}

const notFound = () => Response.json({ error: 'Not found' }, { status: 404 })
const noStore = { 'Cache-Control': 'no-store' }

// Wraps an admin-only handler: requires a session and turns failures into JSON errors.
function adminRoute<R extends Request>(handler: (request: R) => Promise<Response>) {
  return async (request: R) => {
    if (!adminAuth.authorized(request)) {
      return Response.json({ error: 'Please sign in to manage products.' }, { status: 401 })
    }
    try {
      return await handler(request)
    } catch (error) {
      if (error instanceof ProductConflictError) return Response.json({ error: error.message }, { status: 409 })
      if (error instanceof ContentValidationError) return Response.json({ error: error.message }, { status: 400 })
      if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 })
      return productsUnavailable(error)
    }
  }
}

const product = (value: unknown) => value
  ? Response.json(value, { headers: noStore })
  : notFound()

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.API_PORT || 3001),
  maxRequestBodySize: productLimits.photoBytes + 1024 * 1024,
  routes: {
    '/api/health': {
      GET: () => Response.json({ status: 'ok', service: 'palianytsia-bread' }),
    },
    '/api/admin/session': { GET: request => adminAuth.session(request) },
    '/api/admin/login': {
      POST: (request, server) => adminAuth.login(request, server.requestIP(request)?.address ?? 'unknown'),
    },
    '/api/admin/logout': { POST: request => adminAuth.logout(request) },
    '/api/front-page': {
      GET: async () => {
        try {
          return Response.json(await readContent(), { headers: { 'Cache-Control': 'no-store' } })
        } catch (error) {
          return contentUnavailable(error)
        }
      },
      PUT: async request => {
        if (!adminAuth.authorized(request)) {
          return Response.json({ error: 'Please sign in to edit the front page.' }, { status: 401 })
        }
        if (!isJson(request)) {
          return Response.json({ error: 'Send content as JSON.' }, { status: 415 })
        }
        try {
          const content = cleanContent(await readJson(request))
          return Response.json(await saveContent(content), { headers: { 'Cache-Control': 'no-store' } })
        } catch (error) {
          if (error instanceof ContentValidationError || error instanceof SyntaxError) {
            return Response.json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : error.message }, { status: 400 })
          }
          return contentUnavailable(error)
        }
      },
    },
    // Public: enabled products only, for the buy page.
    '/api/products': {
      GET: async () => {
        try {
          return Response.json(await listProducts({ enabledOnly: true }), { headers: noStore })
        } catch (error) {
          return productsUnavailable(error)
        }
      },
    },
    '/api/products/:slug': {
      GET: async request => {
        const { slug } = request.params
        if (slug.length > maxSlugLength + 8 || !slugPattern.test(slug)) return notFound()
        try {
          const found = await getProductBySlug(slug, { enabledOnly: true })
          return found ? Response.json(found, { headers: noStore }) : notFound()
        } catch (error) {
          return productsUnavailable(error)
        }
      },
    },
    '/api/product-photos/:id': {
      GET: async request => {
        const id = parseId(request.params.id)
        if (!id) return notFound()
        try {
          const photo = await readPhoto(id)
          // Photos of disabled products are only visible to a signed-in admin.
          if (!photo || (!photo.enabled && !adminAuth.authorized(request))) return notFound()
          return new Response(new Blob([photo.data as BlobPart]), {
            headers: {
              'Content-Type': 'image/webp',
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': photo.enabled ? 'public, max-age=31536000, immutable' : 'private, no-store',
            },
          })
        } catch (error) {
          return productsUnavailable(error)
        }
      },
    },
    '/api/admin/products': {
      GET: adminRoute(async () => Response.json(await listProducts({ enabledOnly: false }), { headers: noStore })),
      POST: adminRoute(async request => {
        if (!isJson(request)) return Response.json({ error: 'Send the product as JSON.' }, { status: 415 })
        const created = await createProduct(cleanProductInput(await readJson(request)))
        return Response.json(created, { status: 201, headers: noStore })
      }),
    },
    '/api/admin/products/order': {
      PUT: adminRoute(async request => {
        if (!isJson(request)) return Response.json({ error: 'Send the order as JSON.' }, { status: 415 })
        const order = cleanProductOrder(await readJson(request))
        return Response.json(await reorderProducts(order), { headers: noStore })
      }),
    },
    '/api/admin/products/:id': {
      PUT: adminRoute(async request => {
        const id = parseId(request.params.id)
        if (!id) return notFound()
        if (!isJson(request)) return Response.json({ error: 'Send the product as JSON.' }, { status: 415 })
        return product(await updateProduct(id, cleanProductInput(await readJson(request))))
      }),
    },
    '/api/admin/products/:id/photos': {
      POST: adminRoute(async request => {
        const id = parseId(request.params.id)
        if (!id) return notFound()
        if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data')) {
          return Response.json({ error: 'Send the photo as form data.' }, { status: 415 })
        }
        const file = (await request.formData()).get('photo')
        if (!(file instanceof File)) throw new ContentValidationError('Choose a photo to upload.')
        if (!await getProduct(id)) return notFound()
        const photo = await processPhoto(new Uint8Array(await file.arrayBuffer()))
        return product(await addPhoto(id, photo))
      }),
    },
    '/api/admin/products/:id/main-photo': {
      PUT: adminRoute(async request => {
        const id = parseId(request.params.id)
        if (!id) return notFound()
        const body = await readJson(request) as { photoId?: unknown } | null
        const photoId = typeof body?.photoId === 'number' ? body.photoId : null
        if (!photoId || !Number.isSafeInteger(photoId)) throw new ContentValidationError('Choose a photo.')
        return product(await setMainPhoto(id, photoId))
      }),
    },
    '/api/admin/products/:id/photos/:photoId': {
      DELETE: adminRoute(async request => {
        const id = parseId(request.params.id)
        const photoId = parseId(request.params.photoId)
        if (!id || !photoId) return notFound()
        return product(await deletePhoto(id, photoId))
      }),
    },
  },
  fetch() {
    return Response.json({ error: 'Not found' }, { status: 404 })
  },
})

console.log(`Bakery API listening at ${server.url}`)
