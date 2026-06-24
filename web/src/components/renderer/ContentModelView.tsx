import type { ContentModel } from '@/contracts/types'
import { BlockRenderer } from './BlockRenderer'

interface Props {
  contentModel: ContentModel
  assetUrls: Record<string, string | null>
}

// Top-level fixed renderer (contracts §4.3) — mobile-first: single readable
// column at every width, wider breakpoints just add side padding.
export function ContentModelView({ contentModel, assetUrls }: Props) {
  return (
    // w-full + min-w-0: the root layout's <body> is a flex column, and an
    // auto-margin flex item (mx-auto) doesn't stretch to the container's
    // width by default per the flexbox spec — it shrinks to fit its content
    // instead. Without w-full, a wide descendant (the table's
    // min-w-[480px]) becomes that content size and overflows narrow
    // viewports rather than being clipped/scrolled by the table's own
    // overflow-x-auto wrapper.
    <div className="mx-auto w-full min-w-0 max-w-2xl space-y-10 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{contentModel.meta.title}</h1>
        <p className="text-sm text-muted-foreground">
          Est. {contentModel.meta.estimated_minutes} min · {contentModel.meta.language.toUpperCase()}
        </p>
      </header>

      {contentModel.modules.map((courseModule) => (
        <section key={courseModule.id} className="space-y-4">
          <h2 className="border-b pb-2 text-xl font-semibold tracking-tight">{courseModule.title}</h2>
          <div className="space-y-4">
            {courseModule.blocks.map((block, index) => (
              <BlockRenderer key={index} raw={block} index={index} assetUrls={assetUrls} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
