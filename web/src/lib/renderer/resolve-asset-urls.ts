import { createAdminClient } from '@/lib/supabase/admin'

const ARTIFACTS_BUCKET = 'pipeline-artifacts'
const SIGNED_URL_TTL_SECONDS = 300

// Resolves asset_id -> a signed Storage URL at render time (never baked at
// build time). A missing/failed asset maps to null so block components can
// fall back gracefully instead of rendering a broken src.
export async function resolveAssetUrls(
  manifest: { asset_id: string; storage_key: string }[],
): Promise<Record<string, string | null>> {
  const supabase = createAdminClient()

  const entries = await Promise.all(
    manifest.map(async ({ asset_id, storage_key }) => {
      const { data, error } = await supabase.storage.from(ARTIFACTS_BUCKET).createSignedUrl(storage_key, SIGNED_URL_TTL_SECONDS)
      return [asset_id, error ? null : data.signedUrl] as const
    }),
  )

  return Object.fromEntries(entries)
}
