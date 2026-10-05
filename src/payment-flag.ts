// A short note, kept only for this browser tab, that the customer has just been sent to pay for an order. The order
// page uses it to wait for Square's confirmation when they come back. Storage can be blocked, so it is all optional.

const flagKey = 'palianytsia-payment-started'
const flagLifetime = 30 * 60 * 1000

export function setPayFlag(slug: string) {
  try {
    sessionStorage.setItem(flagKey, JSON.stringify({ slug, at: Date.now() }))
  } catch {
    // Without it the page simply will not wait for the confirmation; paying still works.
  }
}

export function hasPayFlag(slug: string) {
  try {
    const flag = JSON.parse(sessionStorage.getItem(flagKey) ?? 'null')
    return flag?.slug === slug && typeof flag.at === 'number' && Date.now() - flag.at < flagLifetime
  } catch {
    return false
  }
}

export function clearPayFlag() {
  try {
    sessionStorage.removeItem(flagKey)
  } catch {
    // Nothing to clear.
  }
}
