import { describe, expect, test } from 'bun:test'
import { X509Certificate } from 'node:crypto'
import { sslWarningDays } from '../shared/health'
import {
  certificateFileExpiry, certificateStats, collectHealth, cpuUsagePercent, parseDf, parseMemAvailableBytes,
  sslTargetFromEnv, tlsCertificateExpiry, type HealthProbes,
} from './health'

// A throwaway self-signed certificate and key, made only for these tests (subject health-test.invalid, valid until 2126).
// It protects nothing and is used nowhere else.
const testCertificate = `-----BEGIN CERTIFICATE-----
MIIBkzCCATmgAwIBAgIUOSVHWsLQEgg8vTWTZ2fkjVTQ/LQwCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTaGVhbHRoLXRlc3QuaW52YWxpZDAgFw0yNjEwMDUxODUzNTZa
GA8yMTI2MDkxMTE4NTM1NlowHjEcMBoGA1UEAwwTaGVhbHRoLXRlc3QuaW52YWxp
ZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABPUBbnShLNd4hikd97sGhmzt2+Cl
hB/cmBDIAoZsD4hk7Kap5qRB0vxQe+e80GqBvDDR+/rsdj6o/sxzAs64TG+jUzBR
MB0GA1UdDgQWBBRPfdJlV7NYsTuK9upMS1bt+nxo2zAfBgNVHSMEGDAWgBRPfdJl
V7NYsTuK9upMS1bt+nxo2zAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gA
MEUCIEaD9Xb+iuJ3O1nXCxqCJlBzTf8hl4HIe2HvPgi7hgSCAiEA/y5LkDKwGjNa
4EQD3wMWgY6mTeKqkF1uGrZt/S8kStY=
-----END CERTIFICATE-----`
const testKey = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgij3g8dTN3Wj5iRsa
Hw0Iz7YQVxqJbNInRbhxBxuoUqKhRANCAAT1AW50oSzXeIYpHfe7BoZs7dvgpYQf
3JgQyAKGbA+IZOymqeakQdL8UHvnvNBqgbww0fv67HY+qP7McwLOuExv
-----END PRIVATE KEY-----`
const testCertificateExpiry = new Date(new X509Certificate(testCertificate).validTo)

const day = 24 * 60 * 60 * 1000

describe('disk figures from df', () => {
  test('a normal Linux line', () => {
    const output = [
      'Filesystem     1K-blocks     Used Available Use% Mounted on',
      '/dev/vda1       51474044 12345678  36432100  26% /',
    ].join('\n')
    expect(parseDf(output)).toEqual({ totalBytes: 51474044 * 1024, freeBytes: 36432100 * 1024, usedPercent: 26 })
  })

  test('a long filesystem name that makes df wrap the numbers onto the next line', () => {
    const output = [
      'Filesystem                         1K-blocks     Used Available Use% Mounted on',
      '/dev/mapper/ubuntu--vg-ubuntu--lv',
      '                                    98327632 41234567  52123456  45% /',
    ].join('\n')
    expect(parseDf(output)).toMatchObject({ totalBytes: 98327632 * 1024, freeBytes: 52123456 * 1024, usedPercent: 45 })
  })

  test('the macOS layout, which has more columns and a second percentage', () => {
    const output = [
      'Filesystem   1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on',
      '/dev/disk3s1   489620264 200000000 250000000    45% 1234567 4290000000    0%   /System/Volumes/Data',
    ].join('\n')
    expect(parseDf(output)).toMatchObject({ totalBytes: 489620264 * 1024, freeBytes: 250000000 * 1024, usedPercent: 45 })
  })

  test('a mount point with spaces in it', () => {
    const output = 'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/sdb1 1000 400 600 40% /mnt/my disk'
    expect(parseDf(output)).toMatchObject({ freeBytes: 600 * 1024, usedPercent: 40 })
  })

  test('output it cannot understand is an error, not a made-up number', () => {
    for (const output of ['', 'Filesystem', 'Filesystem 1K-blocks Used Available Use% Mounted on', 'df: no such file', 'Filesystem a b c d e\n/dev/x a b c d%  /', 'Filesystem 1K Used Av Use% M\n/dev/x 0 0 0 0% /']) {
      expect(() => parseDf(output)).toThrow()
    }
  })
})

describe('CPU usage', () => {
  test('is the busy share of all time between two readings', () => {
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50)
    expect(cpuUsagePercent({ idle: 0, total: 0 }, { idle: 100, total: 100 })).toBe(0)
    expect(cpuUsagePercent({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100)
  })

  test('never leaves 0 to 100, and copes with no time passing', () => {
    expect(cpuUsagePercent({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBe(0)
    expect(cpuUsagePercent({ idle: 5, total: 5 }, { idle: 1, total: 4 })).toBe(0)
    expect(cpuUsagePercent({ idle: 0, total: 0 }, { idle: 200, total: 100 })).toBe(0)
    expect(cpuUsagePercent({ idle: 100, total: 0 }, { idle: 0, total: 100 })).toBe(100)
  })
})

describe('available memory', () => {
  test('is read from MemAvailable in /proc/meminfo', () => {
    const meminfo = 'MemTotal:        2035000 kB\nMemFree:          123456 kB\nMemAvailable:    1024000 kB\nBuffers:            1000 kB\n'
    expect(parseMemAvailableBytes(meminfo)).toBe(1024000 * 1024)
  })

  test('is unknown when the line is missing or malformed', () => {
    for (const meminfo of ['', 'MemTotal: 1 kB', 'MemAvailable: lots kB', 'MemAvailable: -5 kB', 'XMemAvailable: 5 kB']) {
      expect(parseMemAvailableBytes(meminfo)).toBeNull()
    }
  })
})

describe('certificate expiry', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')

  test('counts the days left', () => {
    const result = certificateStats(new Date(now + 60 * day), now)
    expect(result).toEqual({ validTo: new Date(now + 60 * day).toISOString(), daysRemaining: 60, expiringSoon: false })
    expect(certificateStats(new Date(now + 12.34 * day), now).daysRemaining).toBe(12.3)
  })

  test('warns when fewer than ' + sslWarningDays + ' days are left, since renewal should have happened by then', () => {
    expect(certificateStats(new Date(now + 30 * day), now).expiringSoon).toBe(false)
    expect(certificateStats(new Date(now + sslWarningDays * day), now).expiringSoon).toBe(false)
    expect(certificateStats(new Date(now + (sslWarningDays - 0.1) * day), now).expiringSoon).toBe(true)
    expect(certificateStats(new Date(now + 1 * day), now).expiringSoon).toBe(true)
  })

  test('an expired certificate shows negative days and warns', () => {
    const result = certificateStats(new Date(now - 3 * day), now)
    expect(result.daysRemaining).toBe(-3)
    expect(result.expiringSoon).toBe(true)
  })

  test('an unreadable date is an error', () => {
    expect(() => certificateStats(new Date('not a date'), now)).toThrow('expiry date')
  })

  test('the expiry is read from a certificate file’s contents', () => {
    expect(certificateFileExpiry(testCertificate).toISOString()).toBe(testCertificateExpiry.toISOString())
    expect(testCertificateExpiry.getUTCFullYear()).toBe(2126)
    expect(() => certificateFileExpiry('not a certificate')).toThrow()
  })
})

describe('where the certificate is looked for', () => {
  test('a configured file wins', () => {
    expect(sslTargetFromEnv({ SSL_CERT_PATH: ' /etc/ssl/site.pem ', SITE_URL: 'https://example.com' })).toEqual({ kind: 'file', path: '/etc/ssl/site.pem' })
  })

  test('otherwise the live site in SITE_URL, on its own port if it has one', () => {
    expect(sslTargetFromEnv({ SITE_URL: 'https://palianytsiabread.com' })).toEqual({ kind: 'tls', host: 'palianytsiabread.com', port: 443 })
    expect(sslTargetFromEnv({ SITE_URL: 'https://shop.example.com:8443/' })).toEqual({ kind: 'tls', host: 'shop.example.com', port: 8443 })
  })

  test('nothing to check for a plain-http or missing address', () => {
    for (const SITE_URL of [undefined, '', 'http://127.0.0.1:5173', 'not a url', 'ftp://example.com']) {
      expect(sslTargetFromEnv({ SITE_URL })).toBeNull()
    }
  })
})

describe('reading the certificate a visitor is given', () => {
  test('connects over TLS and reads the expiry of the certificate the server presents', async () => {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', tls: { cert: testCertificate, key: testKey }, fetch: () => new Response('ok') })
    try {
      const expiry = await tlsCertificateExpiry('127.0.0.1', server.port)
      expect(expiry.toISOString()).toBe(testCertificateExpiry.toISOString())
    } finally {
      await server.stop(true)
    }
  })

  test('reports a clear problem when nothing is listening', async () => {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') })
    const port = server.port
    await server.stop(true)
    await expect(tlsCertificateExpiry('127.0.0.1', port, 2000)).rejects.toThrow(/Could not connect to 127\.0\.0\.1:\d+/)
  })

  test('reports a problem when the server does not speak TLS', async () => {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('plain http') })
    try {
      await expect(tlsCertificateExpiry('127.0.0.1', server.port, 1500)).rejects.toThrow()
    } finally {
      await server.stop(true)
    }
  })
})

describe('collecting the health figures', () => {
  const now = Date.parse('2026-10-05T12:00:00Z')
  const probes = (overrides: Partial<HealthProbes> = {}): HealthProbes => ({
    disk: async () => ({ totalBytes: 100 * 1024 ** 3, freeBytes: 62.46 * 1024 ** 3, usedPercent: 37.54 }),
    cpu: async () => 12.345,
    ram: () => ({ totalBytes: 2 * 1024 ** 3, freeBytes: 0.5 * 1024 ** 3, usedPercent: 75 }),
    ssl: async () => new Date(now + 45 * day),
    now: () => now,
    ...overrides,
  })
  const env = { SITE_URL: 'https://shop.example.com' }

  test('reports every figure, rounded to one decimal place', async () => {
    expect(await collectHealth(env, probes())).toEqual({
      checkedAt: '2026-10-05T12:00:00.000Z',
      disk: { usedPercent: 37.5, remainingGb: 62.5 },
      cpu: { usedPercent: 12.3 },
      ram: { usedPercent: 75, remainingGb: 0.5 },
      ssl: { validTo: new Date(now + 45 * day).toISOString(), daysRemaining: 45, expiringSoon: false, checked: 'shop.example.com' },
      problems: {},
    })
  })

  test('a failing measurement is reported as a problem while the others are still shown', async () => {
    const boom = (message: string) => async () => { throw new Error(message) }
    const noDisk = await collectHealth(env, probes({ disk: boom('df is not installed') }))
    expect(noDisk.disk).toBeNull()
    expect(noDisk.problems).toEqual({ disk: 'df is not installed' })
    expect(noDisk.cpu).not.toBeNull()
    expect(noDisk.ram).not.toBeNull()
    expect(noDisk.ssl).not.toBeNull()

    const noCpu = await collectHealth(env, probes({ cpu: boom('no cpu data') }))
    expect([noCpu.cpu, noCpu.problems.cpu]).toEqual([null, 'no cpu data'])
    const noRam = await collectHealth(env, probes({ ram: () => { throw new Error('no memory data') } }))
    expect([noRam.ram, noRam.problems.ram]).toEqual([null, 'no memory data'])
    const noSsl = await collectHealth(env, probes({ ssl: boom('Could not connect to shop.example.com:443 (ECONNREFUSED).') }))
    expect(noSsl.ssl).toBeNull()
    expect(noSsl.problems.ssl).toContain('ECONNREFUSED')
    expect(noSsl.disk).not.toBeNull()
  })

  test('everything failing still gives an answer, not an error', async () => {
    const boom = async () => { throw new Error('nope') }
    const result = await collectHealth(env, probes({ disk: boom, cpu: boom, ram: () => { throw new Error('nope') }, ssl: boom }))
    expect([result.disk, result.cpu, result.ram, result.ssl]).toEqual([null, null, null, null])
    expect(Object.keys(result.problems).sort()).toEqual(['cpu', 'disk', 'ram', 'ssl'])
  })

  test('says so when there is no certificate to check, instead of failing', async () => {
    let asked = false
    const result = await collectHealth({ SITE_URL: 'http://127.0.0.1:5173' }, probes({ ssl: async () => { asked = true; return new Date() } }))
    expect(asked).toBe(false)
    expect(result.ssl).toBeNull()
    expect(result.problems.ssl).toContain('SITE_URL is not an https address')
    expect(result.disk).not.toBeNull()
  })

  test('uses the certificate file when one is configured, and says which', async () => {
    let target: unknown
    const result = await collectHealth({ SSL_CERT_PATH: '/etc/ssl/site.pem' }, probes({ ssl: async t => { target = t; return new Date(now + 5 * day) } }))
    expect(target).toEqual({ kind: 'file', path: '/etc/ssl/site.pem' })
    expect(result.ssl).toMatchObject({ checked: '/etc/ssl/site.pem', daysRemaining: 5, expiringSoon: true })
  })

  test('an expired certificate is reported with negative days', async () => {
    const result = await collectHealth(env, probes({ ssl: async () => new Date(now - 2 * day) }))
    expect(result.ssl).toMatchObject({ daysRemaining: -2, expiringSoon: true })
  })

  test('a certificate with an unreadable date is a problem for that figure only', async () => {
    const result = await collectHealth(env, probes({ ssl: async () => new Date('garbage') }))
    expect(result.ssl).toBeNull()
    expect(result.problems.ssl).toContain('expiry date')
    expect(result.cpu).not.toBeNull()
  })

  test('shows a non-standard port for the checked address', async () => {
    const result = await collectHealth({ SITE_URL: 'https://shop.example.com:8443' }, probes())
    expect(result.ssl?.checked).toBe('shop.example.com:8443')
  })

  test('long error text is cut short', async () => {
    const result = await collectHealth(env, probes({ disk: async () => { throw new Error('x'.repeat(1000)) } }))
    expect(result.problems.disk!.length).toBeLessThanOrEqual(300)
  })

  test('on this machine, the real measurements are sensible', async () => {
    const result = await collectHealth({ SITE_URL: 'http://localhost' })
    for (const figure of [result.disk?.usedPercent, result.cpu?.usedPercent, result.ram?.usedPercent]) {
      expect(typeof figure).toBe('number')
      expect(figure!).toBeGreaterThanOrEqual(0)
      expect(figure!).toBeLessThanOrEqual(100)
    }
    expect(result.disk!.remainingGb).toBeGreaterThan(0)
    expect(result.ram!.remainingGb).toBeGreaterThan(0)
    expect(result.problems).toEqual({ ssl: expect.any(String) })
    expect(Math.abs(Date.parse(result.checkedAt) - Date.now())).toBeLessThan(10000)
  })
})
