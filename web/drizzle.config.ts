import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

// Load .env.local for drizzle-kit CLI commands (Next.js doesn't load it automatically here)
config({ path: '.env.local' })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
