const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

// The API only listens on this machine, so connections come from the local nginx, which sets
// X-Forwarded-For to the visitor's address. That header is trusted only on loopback connections; the
// last entry is the one nginx added, so a value supplied by the visitor cannot override it.
export function clientAddress(request: Request, socketAddress: string | undefined): string {
  const forwarded = socketAddress && loopback.has(socketAddress)
    ? request.headers.get('X-Forwarded-For')?.split(',').at(-1)?.trim()
    : undefined
  return forwarded || socketAddress || 'unknown'
}
