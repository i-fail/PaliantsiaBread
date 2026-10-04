export interface ContactMessage {
  name: string
  email: string
  message: string
}

export const contactLimits = { name: 100, email: 254, message: 5000 } as const

// Deliberately simple: one "@", no spaces, and a dot in the domain.
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
