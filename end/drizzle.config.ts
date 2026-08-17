import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.MYSQL_URL ?? 'mysql://root:root@localhost:3306/aiword'
  },
  verbose: true,
  strict: true
} satisfies Config
