// Ukrainian national transliteration (KMU 2010), plus the common Russian letters.
const cyrillic: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'e', '’': '', "'": '',
}

export const maxSlugLength = 80

export const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function slugify(title: string): string {
  const latin = Array.from(title.toLowerCase(), letter => cyrillic[letter] ?? letter).join('')
  const slug = latin
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, maxSlugLength)
    .replace(/-+$/, '')
  return slug || 'product'
}

// Picks the first free slug: the base itself, then base-2, base-3, ...
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let number = 2; ; number++) {
    const candidate = `${base}-${number}`
    if (!used.has(candidate)) return candidate
  }
}
