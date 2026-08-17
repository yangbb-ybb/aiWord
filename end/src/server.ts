import 'dotenv/config'
import { buildApp } from './app'
import { env } from './config/env'
import { pool } from './db'

async function main() {
  const app = await buildApp()

  // 探一下 DB，连不上就警告但不挂服务（开发期体验更好）
  try {
    await pool.query('SELECT 1')
    app.log.info('✅ MySQL connected')
  } catch (err) {
    app.log.warn(
      { err },
      '⚠️  MySQL 连接失败，请检查 .env 里的 MYSQL_URL —— 部分功能将不可用'
    )
  }

  await app.listen({ host: '0.0.0.0', port: env.PORT })
  app.log.info(`🚀 aiWord backend ready at http://localhost:${env.PORT}`)

  const shutdown = async (sig: string) => {
    app.log.info(`\n${sig} received, shutting down...`)
    try {
      await app.close()
      await pool.end()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err) => {
  console.error('启动失败：', err)
  process.exit(1)
})
