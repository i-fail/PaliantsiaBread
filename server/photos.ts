import sharp from 'sharp'
import { productLimits } from '../shared/products'
import { ContentValidationError } from './content'

const allowedFormats = new Set(['jpeg', 'png', 'webp', 'gif', 'avif'])

export interface ProcessedPhoto {
  data: Buffer
  width: number
  height: number
}

// Resizes to at most 800px wide (never enlarging), applies EXIF rotation, and re-encodes as WebP.
export async function processPhoto(input: Uint8Array): Promise<ProcessedPhoto> {
  if (input.byteLength > productLimits.photoBytes) {
    throw new ContentValidationError('Each photo must be 10 MB or smaller.')
  }
  try {
    const source = sharp(input, { limitInputPixels: 80_000_000 })
    const { format } = await source.metadata()
    if (!format || !allowedFormats.has(format)) throw new Error('Unsupported format')
    const { data, info } = await source
      .rotate()
      .resize({ width: productLimits.photoWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch {
    throw new ContentValidationError('Upload a JPEG, PNG, WebP, GIF, or AVIF image.')
  }
}
