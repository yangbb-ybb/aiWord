/**
 * 统一取时间函数 —— 业务代码里所有"取当前时间"的入口。
 *
 * ⚠️ 禁止业务代码直接调 `new Date()`（除了乘法偏移 / 显式参数的构造场景）。
 *    全部走 `now()`，原因：
 *    1. **时区一致性**：依赖 db/index.ts 里锁的 mysql2 driver timezone + MySQL session
 *       time_zone（都 +08:00 北京时间），`now()` 写出去的 Date 落到 DB 里就是正确的
 *       北京时间。如果将来切换时区，只改 db/index.ts 一处即可，业务代码不动。
 *    2. **可测试**：单测可以用 jest.mock('../utils/time') 把 now() 替换成固定时间。
 *    3. **可审计**：所有"取时间"意图集中在这一文件，code review 一眼能数清。
 *
 * 实现说明：mysql2 driver 用 `timezone: '+08:00'` 把 JS Date 序列化成 UTC+8 字符串，
 * MySQL TIMESTAMP 列按 session time_zone = '+08:00' 解释并把 UTC 内部存好。
 * 所以 `now()` 直接返回 `new Date()` 即可，**不要**自己加 8 小时偏移——
 * 那样会产生一个"假 8 小时后的 Date"，跟 `Date.now()`、`expiresAt.getTime()` 等
 * epoch 比较会算错。
 *
 * ⚠️ `Date.now()`（epoch ms）不算"取时间"——它是 timezone-safe 的纯毫秒，
 *    用于"距现在多久 / 多久过期"这类算术时不必走 now()。混用没问题。
 */
export function now(): Date {
  return new Date()
}

/**
 * 把一个 Date 渲染成北京时间字符串 `YYYY-MM-DD HH:mm:ss`，例如 `2026-08-19 14:08:15`。
 *
 * 用在：日志、API 响应、对外文档、文件名等需要"人看得懂"的场景。
 * **不要**用于 DB 写入或 epoch 比较 —— 那种场景继续用 `now()` 拿 Date。
 *
 * 时区硬编码为 Asia/Shanghai (+08:00)，跟 db/index.ts 里的时区策略保持一致：
 * DB 存的是 UTC 内部表示 + session time_zone='+08:00'，对用户展示也用 +08:00，
 * 整个项目只有这一个时区。将来如果要切时区，同样只改一处。
 */
export function formatDateTime(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  // 把 epoch ms 平移到 +08:00，再按 UTC 方法取年月日时分秒
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  return (
    `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ` +
    `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`
  )
}

/** `now()` + `formatDateTime()` 的便捷组合 —— 当前北京时间的 `YYYY-MM-DD HH:mm:ss`。 */
export function nowString(): string {
  return formatDateTime(now())
}
