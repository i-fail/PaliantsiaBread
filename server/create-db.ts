import { SQL } from 'bun'
import { randomBytes } from 'node:crypto'

const adminUrl = process.env.POSTGRES_ADMIN_URL
if (!adminUrl) throw new Error('Set POSTGRES_ADMIN_URL in .env before running db:create.')

const admin = new SQL(adminUrl, { max: 1, connectionTimeout: 5 })
const databaseName = 'palianytsia'
const roleName = 'palianytsia_app'

try {
  const databases = await admin`SELECT 1 FROM pg_database WHERE datname = ${databaseName}`
  const roles = await admin`SELECT 1 FROM pg_roles WHERE rolname = ${roleName}`
  if (databases.length || roles.length) {
    throw new Error('The palianytsia database or palianytsia_app role already exists. Configure DATABASE_URL for it instead of recreating it.')
  }

  const password = randomBytes(32).toString('hex')
  // Names are fixed and the generated password contains only hexadecimal characters.
  await admin.unsafe(`CREATE ROLE palianytsia_app LOGIN PASSWORD '${password}'`)
  try {
    await admin.unsafe('CREATE DATABASE palianytsia OWNER palianytsia_app')
  } catch (error) {
    await admin.unsafe('DROP ROLE palianytsia_app')
    throw error
  }

  const databaseUrl = new URL(adminUrl)
  databaseUrl.username = roleName
  databaseUrl.password = password
  databaseUrl.pathname = `/${databaseName}`

  const envFile = Bun.file(new URL('../.env', import.meta.url))
  let env = await envFile.exists() ? await envFile.text() : ''
  const setValue = (key: string, value: string) => {
    const line = `${key}=${value}`
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    env = pattern.test(env) ? env.replace(pattern, () => line) : `${env.trimEnd()}\n${line}\n`
  }
  setValue('DATABASE_URL', databaseUrl.toString())
  if (!process.env.ADMIN_PASSWORD) setValue('ADMIN_PASSWORD', randomBytes(24).toString('hex'))
  // The application only needs its dedicated user's credentials after setup.
  env = env.replace(/^POSTGRES_ADMIN_URL=.*(?:\r?\n|$)/m, '')
  await Bun.write(envFile, env.trimStart())
  console.log('Created palianytsia and its dedicated application user. DATABASE_URL and ADMIN_PASSWORD are in .env. The setup administrator URL was removed from .env. Run bun run db:migrate next.')
} finally {
  await admin.close()
}
