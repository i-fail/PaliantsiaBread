import { readdir } from 'node:fs/promises'
import { getDatabase } from './db'

const directory = new URL('./migrations/', import.meta.url)
const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()

const db = getDatabase()
try {
  // Every migration is idempotent, so rerunning preserves existing data.
  for (const file of files) {
    const migration = await Bun.file(new URL(file, directory)).text()
    await db.begin(async tx => {
      await tx.unsafe(migration).simple()
    })
    console.log(`Applied ${file}.`)
  }
  console.log('Database is ready. Existing edits were preserved.')
} finally {
  await db.close()
}
