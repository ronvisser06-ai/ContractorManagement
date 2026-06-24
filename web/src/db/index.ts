import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Used for server-side queries and migrations.
// The Supabase client (@supabase/supabase-js) handles auth and realtime;
// this connection is for direct Postgres access via Drizzle.
const client = postgres(process.env.DATABASE_URL!)

export const db = drizzle(client, { schema })
