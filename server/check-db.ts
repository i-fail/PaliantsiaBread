import { getDatabase } from './db'

try {
  const db = getDatabase()
  try {
    await db`SELECT 1 AS connected`
    console.log('PostgreSQL connection successful.')
  } finally {
    await db.close()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database connection failed.')
  process.exitCode = 1
}
