import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { sslWarningDays, type ServerHealth } from '../shared/health'

const bytesPerGb = 1024 ** 3
const round = (value: number) => Number(value.toFixed(1))

// ---- Disk ----

export interface DiskStats {
  totalBytes: number
  freeBytes: number
  usedPercent: number
}

// Reads the output of `df -k <path>`. A long filesystem name makes df wrap the numbers onto the next line, so the
// numbers are found by the "NN%" column rather than by position.
export function parseDf(output: string): DiskStats {
  const tokens = output.trim().split(/\r?\n/).slice(1).join(' ').trim().split(/\s+/)
  const percentAt = tokens.findIndex((token, index) => /^\d+%$/.test(token) && index >= 3)
  if (percentAt < 0) throw new Error('Unexpected disk stats output.')
  const [totalKb, , availableKb] = tokens.slice(percentAt - 3, percentAt).map(Number)
  const usedPercent = Number(tokens[percentAt]!.replace('%', ''))
  if (![totalKb, availableKb, usedPercent].every(value => Number.isFinite(value)) || totalKb! <= 0) {
    throw new Error('Incomplete disk stats.')
  }
  return { totalBytes: totalKb! * 1024, freeBytes: availableKb! * 1024, usedPercent }
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 8000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message))
      else resolve(stdout)
    })
  })
}

// The disk the app is on. Windows is supported only so the tab works during development.
export async function readDiskStats(): Promise<DiskStats> {
  if (process.platform !== 'win32') return parseDf(await run('df', ['-k', process.cwd()]))

  const drive = path.parse(process.cwd()).root.replace(/[\\/]+$/, '')
  const command = `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID = '${drive}'" | Select-Object Size, FreeSpace | ConvertTo-Json -Compress`
  const parsed = JSON.parse((await run('powershell.exe', ['-NoProfile', '-Command', command])).trim() || 'null')
  const totalBytes = Number(parsed?.Size)
  const freeBytes = Number(parsed?.FreeSpace)
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) throw new Error('Incomplete disk stats.')
  return { totalBytes, freeBytes, usedPercent: ((totalBytes - freeBytes) / totalBytes) * 100 }
}

// ---- CPU ----

export interface CpuTimes {
  idle: number
  total: number
}

export function readCpuTimes(): CpuTimes {
  return os.cpus().reduce((totals, cpu) => {
    totals.idle += cpu.times.idle
    totals.total += Object.values(cpu.times).reduce((sum, value) => sum + value, 0)
    return totals
  }, { idle: 0, total: 0 })
}

// How busy all cores were between two readings, as a percentage.
export function cpuUsagePercent(start: CpuTimes, end: CpuTimes): number {
  const total = end.total - start.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (1 - (end.idle - start.idle) / total) * 100))
}

export async function readCpuUsage(sampleMs = 500): Promise<number> {
  const start = readCpuTimes()
  await new Promise(resolve => setTimeout(resolve, sampleMs))
  return cpuUsagePercent(start, readCpuTimes())
}

// ---- Memory ----

export interface MemoryStats {
  totalBytes: number
  freeBytes: number
  usedPercent: number
}

// "MemAvailable" is what could be used without swapping, which is a truer "free" than the operating system's
// plain free-memory figure (Linux keeps spare memory busy caching files).
export function parseMemAvailableBytes(meminfo: string): number | null {
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m)
  const kb = match ? Number(match[1]) : NaN
  return Number.isFinite(kb) && kb >= 0 ? kb * 1024 : null
}

export function readMemoryStats(): MemoryStats {
  const totalBytes = os.totalmem()
  let freeBytes = os.freemem()
  if (process.platform === 'linux') {
    try {
      freeBytes = parseMemAvailableBytes(fs.readFileSync('/proc/meminfo', 'utf8')) ?? freeBytes
    } catch {
      // Fall back to the operating system's own figure.
    }
  }
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) throw new Error('Failed to read memory stats.')
  return { totalBytes, freeBytes, usedPercent: ((totalBytes - freeBytes) / totalBytes) * 100 }
}

// ---- SSL certificate ----

export interface CertificateStats {
  validTo: string
  daysRemaining: number
  expiringSoon: boolean
}

export function certificateStats(validTo: Date, now = Date.now()): CertificateStats {
  const expiresAt = validTo.getTime()
  if (!Number.isFinite(expiresAt)) throw new Error('Could not read the certificate’s expiry date.')
  const daysRemaining = (expiresAt - now) / (1000 * 60 * 60 * 24)
  return { validTo: validTo.toISOString(), daysRemaining: round(daysRemaining), expiringSoon: daysRemaining < sslWarningDays }
}

export function certificateFileExpiry(pem: string): Date {
  return new Date(new X509Certificate(pem).validTo)
}

// The certificate a visitor is actually given: connect the way a browser would and read its expiry. Only the
// dates are inspected, so an expired or untrusted certificate is still reported instead of failing the check.
export function tlsCertificateExpiry(host: string, port = 443, timeoutMs = 5000): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false })
    const fail = (error: Error) => { socket.destroy(); reject(error) }
    socket.setTimeout(timeoutMs, () => fail(new Error(`No answer from ${host}:${port} within ${timeoutMs / 1000} seconds.`)))
    socket.once('error', error => fail(new Error(`Could not connect to ${host}:${port} (${(error as NodeJS.ErrnoException).code ?? error.message}).`)))
    socket.once('secureConnect', () => {
      const validTo = socket.getPeerCertificate().valid_to
      socket.end()
      if (!validTo) reject(new Error(`${host} did not present a certificate.`))
      else resolve(new Date(validTo))
    })
  })
}

// Where to look for the certificate: a file if SSL_CERT_PATH is set, otherwise the live site named by SITE_URL.
export type SslTarget = { kind: 'file'; path: string } | { kind: 'tls'; host: string; port: number }

export function sslTargetFromEnv(env: Record<string, string | undefined>): SslTarget | null {
  const file = env.SSL_CERT_PATH?.trim()
  if (file) return { kind: 'file', path: file }
  try {
    const url = new URL(env.SITE_URL?.trim() ?? '')
    if (url.protocol === 'https:') return { kind: 'tls', host: url.hostname, port: Number(url.port) || 443 }
  } catch {
    // No usable SITE_URL.
  }
  return null
}

// ---- Putting it together ----

export interface HealthProbes {
  disk: () => Promise<DiskStats>
  cpu: () => Promise<number>
  ram: () => MemoryStats | Promise<MemoryStats>
  ssl: (target: SslTarget) => Promise<Date>
  now: () => number
}

const realProbes: HealthProbes = {
  disk: readDiskStats,
  cpu: () => readCpuUsage(),
  ram: readMemoryStats,
  ssl: target => target.kind === 'file'
    ? Promise.resolve().then(() => certificateFileExpiry(fs.readFileSync(target.path, 'utf8')))
    : tlsCertificateExpiry(target.host, target.port),
  now: Date.now,
}

const reason = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error').slice(0, 300)

// Takes every measurement at once. A measurement that fails is reported as a problem and does not affect the others.
export async function collectHealth(env: Record<string, string | undefined>, probes: HealthProbes = realProbes): Promise<ServerHealth> {
  const target = sslTargetFromEnv(env)
  const [disk, cpu, ram, ssl] = await Promise.allSettled([
    probes.disk(),
    probes.cpu(),
    Promise.resolve().then(() => probes.ram()),
    target ? probes.ssl(target) : Promise.reject(new Error('Nothing to check: SITE_URL is not an https address and SSL_CERT_PATH is not set.')),
  ])

  const health: ServerHealth = { checkedAt: new Date(probes.now()).toISOString(), disk: null, cpu: null, ram: null, ssl: null, problems: {} }
  if (disk.status === 'fulfilled') health.disk = { usedPercent: round(disk.value.usedPercent), remainingGb: round(disk.value.freeBytes / bytesPerGb) }
  else health.problems.disk = reason(disk.reason)
  if (cpu.status === 'fulfilled') health.cpu = { usedPercent: round(cpu.value) }
  else health.problems.cpu = reason(cpu.reason)
  if (ram.status === 'fulfilled') health.ram = { usedPercent: round(ram.value.usedPercent), remainingGb: round(ram.value.freeBytes / bytesPerGb) }
  else health.problems.ram = reason(ram.reason)
  if (ssl.status === 'fulfilled' && target) {
    try {
      health.ssl = {
        ...certificateStats(ssl.value, probes.now()),
        checked: target.kind === 'file' ? target.path : `${target.host}${target.port === 443 ? '' : ':' + target.port}`,
      }
    } catch (error) {
      health.problems.ssl = reason(error)
    }
  } else if (ssl.status === 'rejected') {
    health.problems.ssl = reason(ssl.reason)
  }
  return health
}
