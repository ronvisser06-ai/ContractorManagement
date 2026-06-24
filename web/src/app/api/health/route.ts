import { db } from '@/db'
import { organizations, sites, users, orgMemberships } from '@/db/schema'
import { sql } from 'drizzle-orm'

export async function GET() {
  try {
    const [dbName] = await db.execute(sql`SELECT current_database() AS db`)
    const tables = await db.execute(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('users','organizations','sites','org_memberships')
      ORDER BY tablename
    `)
    const rlsCheck = await db.execute(sql`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN ('users','organizations','sites','org_memberships')
        AND relkind = 'r'
      ORDER BY relname
    `)
    return Response.json({
      ok: true,
      database: (dbName as Record<string, unknown>).db,
      tables: tables.map((r: Record<string, unknown>) => r.tablename),
      rls: rlsCheck.map((r: Record<string, unknown>) => ({
        table: r.relname,
        rls_enabled: r.relrowsecurity,
      })),
    })
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err) },
      { status: 500 },
    )
  }
}
