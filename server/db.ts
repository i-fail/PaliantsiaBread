import { SQL } from 'bun'

let database: SQL | undefined

// Connect only when a database-backed feature requests it.
export function getDatabase(): SQL {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Set DATABASE_URL in .env to connect to PostgreSQL.')
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL.')
  }

  database ??= new SQL(url, { max: 5, connectionTimeout: 5 })
  return database
}
