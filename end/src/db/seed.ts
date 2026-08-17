import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { db, schema } from '~/db'

const templates = [
  {
    name: '工作周报',
    emoji: '📅',
    description: '本周完成 / 下周计划 / 风险与阻塞',
    sort: 10,
    content: `# 工作周报（YYYY-MM-DD ~ YYYY-MM-DD）

## 本周完成
-

## 下周计划
-

## 风险与阻塞
-
`
  },
  {
    name: '会议纪要',
    emoji: '📝',
    description: '会议信息 / 议题 / 决议 / 待办',
    sort: 20,
    content: `# 会议纪要

- 时间：
- 地点：
- 参会人：

## 议题讨论

## 决议事项

## 待办事项
- [ ] @责任人：
`
  },
  {
    name: '项目总结',
    emoji: '📊',
    description: '背景 / 目标 / 进展 / 数据 / 反思',
    sort: 30,
    content: `# 项目总结：xxx

## 项目背景

## 目标与指标

## 关键进展

## 数据表现

## 反思与下一步
`
  },
  {
    name: '公众号推文',
    emoji: '📣',
    description: '钩子开头 + 故事 + 行动号召',
    sort: 40,
    content: `# 一个让读者停不下来的标题

> 写在最前：用一个反常识的事实作为开场。

## 现象

观察到什么？

## 思考

为什么会这样？

## 行动

我们能做什么？

---

如果觉得有用，欢迎转发给身边的朋友 🙌
`
  }
]

async function main() {
  console.log('🪴 正在写入模板…')

  // 先清空再插入，方便重复 seed
  await db.delete(schema.templates)

  for (const t of templates) {
    await db.insert(schema.templates).values(t)
  }

  console.log(`✅ 写入 ${templates.length} 条模板`)

  // ---------- 写入一个开发用户（幂等：邮箱已存在则跳过） ----------
  console.log('👤 正在写入 demo 用户…')
  const demoEmail = 'demo@aiword.local'
  const demoPassword = 'demo123456'

  const existed = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, demoEmail))
    .limit(1)

  if (existed.length === 0) {
    const passwordHash = await bcrypt.hash(demoPassword, 10)
    await db.insert(schema.users).values({
      nickname: 'demo',
      email: demoEmail,
      passwordHash,
      role: 'admin',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=demo'
    })
    console.log(`✅ 写入 demo 用户: ${demoEmail} / ${demoPassword}`)
  } else {
    console.log(`↩️  demo 用户已存在，跳过`)
  }

  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
