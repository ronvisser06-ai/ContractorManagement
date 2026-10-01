// Preloaded before every test run (`--import` in the npm test script) and by
// dev scripts: refuse to run against the PRODUCTION Supabase project (ConTrak).
// Tests create and delete accounts and rows — they must only ever touch the
// dev/test project configured in web/.env.local.

const PRODUCTION_REFS = ['mjmgicubneitwqyaatxp'] // ConTrak (production)

const checked: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
}

for (const [name, value] of Object.entries(checked)) {
  const ref = value && PRODUCTION_REFS.find((r) => value.includes(r))
  if (ref) {
    console.error(
      `\nRefusing to run: ${name} points at the PRODUCTION Supabase project (${ref}).\n` +
        'Point web/.env.local at the dev/test project (ConTrak Dev) instead.\n',
    )
    process.exit(1)
  }
}
