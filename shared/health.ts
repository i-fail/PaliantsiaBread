// What the admin's "Server Health" tab shows. Every measurement is independent: if one cannot be taken it is null
// and the reason is in `problems`, so the others are still shown.
export interface ServerHealth {
  checkedAt: string
  disk: { usedPercent: number; remainingGb: number } | null
  cpu: { usedPercent: number } | null
  ram: { usedPercent: number; remainingGb: number } | null
  ssl: { validTo: string; daysRemaining: number; expiringSoon: boolean; checked: string } | null
  problems: Partial<Record<'disk' | 'cpu' | 'ram' | 'ssl', string>>
}

// Let's Encrypt certificates are renewed when 30 days are left, so fewer than this means renewal has been failing.
export const sslWarningDays = 14
