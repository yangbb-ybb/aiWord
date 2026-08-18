import 'dotenv/config'
import { buildApp } from './app'
import { env } from './config/env'
import { pool } from './db'
import { purgeOldDocuments } from './services/documents'

/** 回收站清理间隔：默认 24 小时（开发期可以拉短，prod 跑一天一次足够） */
const PURGE_INTERVAL_MS = Number(process.env.PURGE_INTERVAL_MS ?? 24 * 60 * 60 * 1000)

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

  // 软删除清理：30 天前被丢进回收站的文档，物理删除（用户主动"彻底删除"不受此约束）
  // - 启动时跑一次（兜底：上次崩了可能漏了）
  // - 之后每隔 PURGE_INTERVAL_MS 跑一次
  const runPurge = async () => {
    try {
      const n = await purgeOldDocuments(30)
      if (n > 0) app.log.info(`🧹 已清理回收站文档 ${n} 篇`)
    } catch (err) {
      app.log.warn({ err }, '⚠️  回收站清理失败，下个周期重试')
    }
  }
  runPurge()
  const purgeTimer = setInterval(runPurge, PURGE_INTERVAL_MS)
  // unref 后定时器不会阻止进程退出
  purgeTimer.unref?.()

  await app.listen({ host: '0.0.0.0', port: env.PORT })
  app.log.info(`🚀 aiWord backend ready at http://localhost:${env.PORT}`)

  const shutdown = async (sig: string) => {
    app.log.info(`\n${sig} received, shutting down...`)
    try {
      clearInterval(purgeTimer)
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
