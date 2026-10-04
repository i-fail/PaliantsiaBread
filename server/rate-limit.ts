// Allows `max` calls per key within a sliding `windowMs`; used to keep public forms from being abused.
export function createRateLimiter({ max, windowMs, now = Date.now }: { max: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>()

  return {
    // Records an attempt and returns whether it is allowed.
    take(key: string): boolean {
      const current = now()
      for (const [other, times] of hits) {
        const recent = times.filter(time => current - time < windowMs)
        if (recent.length) hits.set(other, recent)
        else hits.delete(other)
      }
      const recent = hits.get(key) ?? []
      if (recent.length >= max) return false
      hits.set(key, [...recent, current])
      return true
    },
  }
}
