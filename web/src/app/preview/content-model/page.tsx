import { ContentModelView } from '@/components/renderer/ContentModelView'
import type { ContentModel } from '@/contracts/types'
import { fixtureAssetManifest, fixtureContentModel } from '@/lib/renderer/fixture'
import { resolveAssetUrls } from '@/lib/renderer/resolve-asset-urls'

// Dev/QA-only preview route (Feature 2, Step 4): renders the canned
// ContentModel fixture through the fixed renderer so it can be checked in a
// real browser before any approval/publish flow exists (Step 5+). No tenant
// data involved — safe to leave unauthenticated at this skeleton stage.
//
// Signed URLs must be created per request, not baked into a static page at
// build time (they expire) — force-dynamic, since Next can't otherwise tell
// this route's data is dynamic (the Supabase call isn't a Next-wrapped fetch).
export const dynamic = 'force-dynamic'

export default async function ContentModelPreviewPage() {
  const assetUrls = await resolveAssetUrls(fixtureAssetManifest)
  return <ContentModelView contentModel={fixtureContentModel as ContentModel} assetUrls={assetUrls} />
}
