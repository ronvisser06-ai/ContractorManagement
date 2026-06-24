import { validateBlock } from '@/lib/renderer/validate'
import {
  CalloutBlockView,
  HazardBlockView,
  HeadingBlockView,
  ImageBlockView,
  KeyPointBlockView,
  ListBlockView,
  ParagraphBlockView,
  TableBlockView,
  UnknownBlockPlaceholder,
  VideoBlockView,
} from './blocks'

interface Props {
  raw: unknown
  index: number
  assetUrls: Record<string, string | null>
}

// The render contract (§4.3): a block is validated here, then dispatched to
// its fixed component. An unknown/invalid block never reaches a renderer
// component — validateBlock is the single gate that keeps the block-type set
// closed at render time, dev or prod.
export function BlockRenderer({ raw, index, assetUrls }: Props) {
  const result = validateBlock(raw, index)

  if (result.error) {
    const type =
      typeof raw === 'object' && raw !== null && 'type' in raw ? String((raw as Record<string, unknown>).type) : 'unknown'
    return <UnknownBlockPlaceholder index={index} type={type} reason={result.error.reason} />
  }

  const block = result.block
  switch (block.type) {
    case 'heading':
      return <HeadingBlockView block={block} />
    case 'paragraph':
      return <ParagraphBlockView block={block} />
    case 'list':
      return <ListBlockView block={block} />
    case 'key_point':
      return <KeyPointBlockView block={block} />
    case 'callout':
      return <CalloutBlockView block={block} />
    case 'hazard':
      return <HazardBlockView block={block} />
    case 'image':
      return <ImageBlockView block={block} url={assetUrls[block.asset_id] ?? null} />
    case 'video':
      return (
        <VideoBlockView
          block={block}
          url={assetUrls[block.asset_id] ?? null}
          posterUrl={block.poster_asset_id ? assetUrls[block.poster_asset_id] ?? null : null}
        />
      )
    case 'table':
      return <TableBlockView block={block} />
  }
}
