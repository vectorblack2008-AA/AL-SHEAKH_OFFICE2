import { createApp } from './app.js'
import { db, initializeDatabase } from './db.js'

const PORT = Number(process.env.PORT || 3001)
const app = createApp()

async function start() {
  await initializeDatabase()
  const server = app.listen(PORT, () => {
    console.log(`[api] Al-Sheikh Office API listening on http://localhost:${PORT} (${db.driver})`)
  })

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`)
    server.close(async () => {
      await db.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

start().catch((error) => {
  console.error('[api] Failed to start', error)
  process.exit(1)
})
