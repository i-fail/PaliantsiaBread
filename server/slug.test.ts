import { describe, expect, test } from 'bun:test'
import { maxSlugLength, slugify, slugPattern, uniqueSlug } from './slug'

describe('slugify', () => {
  test('lowercases and joins words with dashes', () => {
    expect(slugify('Old-World Chornobaivsky Dark Rye')).toBe('old-world-chornobaivsky-dark-rye')
    expect(slugify('  Rye   loaf!! ')).toBe('rye-loaf')
  })

  test('transliterates Ukrainian titles', () => {
    expect(slugify('Паляниця')).toBe('palianytsia')
    expect(slugify('Житній хліб з журавлиною')).toBe('zhytnii-khlib-z-zhuravlynoiu')
    expect(slugify('Щедрий Ґанок')).toBe('shchedryi-ganok')
  })

  test('removes accents and symbols', () => {
    expect(slugify('Crème brûlée & Co.')).toBe('creme-brulee-co')
  })

  test('falls back when nothing usable remains', () => {
    expect(slugify('★★★')).toBe('product')
    expect(slugify('')).toBe('product')
  })

  test('limits the length without leaving a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(78)} bread loaf`)
    expect(slug.length).toBeLessThanOrEqual(maxSlugLength)
    expect(slug.endsWith('-')).toBe(false)
  })

  test('always produces a valid URL name', () => {
    for (const title of ['Rye', 'ЖИТНІЙ — 100%', 'a_b c', '日本語', "O'Brien's loaf"]) {
      expect(slugify(title)).toMatch(slugPattern)
    }
  })
})

describe('uniqueSlug', () => {
  test('keeps a free slug and numbers a taken one', () => {
    expect(uniqueSlug('rye', [])).toBe('rye')
    expect(uniqueSlug('rye', ['rye'])).toBe('rye-2')
    expect(uniqueSlug('rye', ['rye', 'rye-2', 'rye-3'])).toBe('rye-4')
    expect(uniqueSlug('rye', ['rye', 'rye-3'])).toBe('rye-2')
  })
})
