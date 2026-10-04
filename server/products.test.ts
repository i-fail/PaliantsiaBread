import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { formatPrice, maxPriceCents, parsePrice, priceToInput, productLimits } from '../shared/products'
import { ContentValidationError } from './content'
import { processPhoto } from './photos'
import { cleanProductInput, cleanProductOrder } from './products'

const valid = { sku: 'RYE-01', title: 'Rye loaf', description: 'Dark rye.', enabled: true, priceCents: 1250, shippingAvailable: true }

describe('product validation', () => {
  test('accepts and trims valid input', () => {
    expect(cleanProductInput({ ...valid, sku: ' RYE-01 ', title: ' Rye loaf ' })).toEqual(valid)
    expect(cleanProductInput({ ...valid, description: '' }).description).toBe('')
  })

  test('accepts a missing price only as an explicit null', () => {
    expect(cleanProductInput({ ...valid, priceCents: null }).priceCents).toBeNull()
    const { priceCents: _omitted, ...withoutPrice } = valid
    expect(() => cleanProductInput(withoutPrice)).toThrow(ContentValidationError)
  })

  test('rejects prices that are not whole cents in range', () => {
    for (const priceCents of [0, -5, 12.5, '12.50', NaN, Infinity, maxPriceCents + 1, undefined, true]) {
      expect(() => cleanProductInput({ ...valid, priceCents })).toThrow(ContentValidationError)
    }
    expect(cleanProductInput({ ...valid, priceCents: 1 }).priceCents).toBe(1)
    expect(cleanProductInput({ ...valid, priceCents: maxPriceCents }).priceCents).toBe(maxPriceCents)
  })

  test('requires shipping availability to be a true or false value', () => {
    expect(cleanProductInput({ ...valid, shippingAvailable: false }).shippingAvailable).toBe(false)
    const { shippingAvailable: _omitted, ...withoutShipping } = valid
    for (const input of [withoutShipping, { ...valid, shippingAvailable: 'yes' }, { ...valid, shippingAvailable: 1 }, { ...valid, shippingAvailable: null }]) {
      expect(() => cleanProductInput(input)).toThrow(ContentValidationError)
    }
  })

  test('keeps markup as plain text instead of interpreting it', () => {
    expect(cleanProductInput({ ...valid, title: '<b>Rye</b>' }).title).toBe('<b>Rye</b>')
  })

  test('rejects invalid shapes, SKUs, and lengths', () => {
    const bad = [
      null, [], {}, 'x',
      { ...valid, sku: '' }, { ...valid, sku: 'has space' }, { ...valid, sku: '-leading' },
      { ...valid, sku: 'x'.repeat(productLimits.sku + 1) },
      { ...valid, title: '   ' }, { ...valid, title: 'x'.repeat(productLimits.title + 1) },
      { ...valid, description: 'x'.repeat(productLimits.description + 1) },
      { ...valid, description: 5 }, { ...valid, enabled: 'yes' }, { sku: 'A', title: 'B', description: '' },
    ]
    for (const input of bad) expect(() => cleanProductInput(input)).toThrow(ContentValidationError)
  })
})

describe('price helpers', () => {
  test('reads typed prices as whole cents', () => {
    expect(parsePrice('12')).toBe(1200)
    expect(parsePrice('12.5')).toBe(1250)
    expect(parsePrice('12.50')).toBe(1250)
    expect(parsePrice(' 0.99 ')).toBe(99)
    expect(parsePrice('19.99')).toBe(1999)
    expect(parsePrice('100000')).toBe(maxPriceCents)
  })

  test('rejects anything that is not a positive amount', () => {
    for (const text of ['', ' ', '0', '0.00', '-1', '1.234', '1,50', '$5', 'abc', '1e3', '.5', '5.', '100000.01', '99999999']) {
      expect(parsePrice(text)).toBeNull()
    }
  })

  test('formats and round-trips prices', () => {
    expect(formatPrice(1250)).toBe('$12.50')
    expect(formatPrice(99)).toBe('$0.99')
    expect(priceToInput(1250)).toBe('12.50')
    expect(parsePrice(priceToInput(1999))).toBe(1999)
  })
})

describe('product order validation', () => {
  test('accepts a list of unique ids', () => {
    expect(cleanProductOrder({ ids: [3, 1, 2] })).toEqual([3, 1, 2])
  })

  test('rejects missing, empty, duplicate, and non-integer ids', () => {
    for (const input of [null, {}, { ids: 'x' }, { ids: [] }, { ids: [1, 1] }, { ids: [0] }, { ids: [-1] }, { ids: [1.5] }, { ids: ['1'] }]) {
      expect(() => cleanProductOrder(input)).toThrow(ContentValidationError)
    }
  })
})

describe('photo processing', () => {
  const make = (width: number, height: number, format: 'jpeg' | 'png') =>
    sharp({ create: { width, height, channels: 3, background: '#a06030' } })[format]().toBuffer()

  test('shrinks wide images to 800px and converts to WebP', async () => {
    const photo = await processPhoto(await make(2400, 1200, 'jpeg'))
    expect(photo.width).toBe(800)
    expect(photo.height).toBe(400)
    const meta = await sharp(photo.data).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 800, 400])
  })

  test('never enlarges small images', async () => {
    const photo = await processPhoto(await make(300, 200, 'png'))
    expect([photo.width, photo.height]).toEqual([300, 200])
  })

  test('rejects non-images and SVG', async () => {
    await expect(processPhoto(new TextEncoder().encode('not an image'))).rejects.toThrow(ContentValidationError)
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    await expect(processPhoto(svg)).rejects.toThrow(ContentValidationError)
  })

  test('rejects files over the size limit', async () => {
    await expect(processPhoto(new Uint8Array(productLimits.photoBytes + 1))).rejects.toThrow('10 MB')
  })
})
