import Image from 'next/image'
import { AlertOctagon, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import type {
  CalloutBlock,
  HazardBlock,
  HeadingBlock,
  ImageBlock,
  KeyPointBlock,
  ListBlock,
  ParagraphBlock,
  TableBlock,
  VideoBlock,
} from '@/contracts/types'

// The closed block-type set (contracts §4.3). Every component here renders
// only the typed fields it's given — block text is always plain text content,
// never injected as HTML/markup.

export function HeadingBlockView({ block }: { block: HeadingBlock }) {
  const className = 'font-semibold tracking-tight text-foreground'
  if (block.level === 1) return <h2 className={`${className} text-xl sm:text-2xl`}>{block.text}</h2>
  if (block.level === 2) return <h3 className={`${className} text-lg sm:text-xl`}>{block.text}</h3>
  return <h4 className={`${className} text-base sm:text-lg`}>{block.text}</h4>
}

export function ParagraphBlockView({ block }: { block: ParagraphBlock }) {
  return <p className="text-base leading-relaxed text-foreground/90">{block.text}</p>
}

export function ListBlockView({ block }: { block: ListBlock }) {
  const items = block.items.map((item, i) => <li key={i}>{item}</li>)
  return block.ordered ? (
    <ol className="list-decimal space-y-1 pl-5 text-base leading-relaxed">{items}</ol>
  ) : (
    <ul className="list-disc space-y-1 pl-5 text-base leading-relaxed">{items}</ul>
  )
}

export function KeyPointBlockView({ block }: { block: KeyPointBlock }) {
  return (
    <p className="rounded-md border-l-4 border-primary bg-primary/5 px-4 py-3 text-base font-medium">
      {block.text}
    </p>
  )
}

const CALLOUT_STYLES = {
  info: { container: 'border-blue-500/40 bg-blue-500/10 text-blue-900', icon: Info, iconClass: 'text-blue-600' },
  warning: {
    container: 'border-amber-500/50 bg-amber-500/10 text-amber-900',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
  },
  critical: {
    container: 'border-destructive/60 bg-destructive/10 text-destructive',
    icon: AlertOctagon,
    iconClass: 'text-destructive',
  },
} as const

export function CalloutBlockView({ block }: { block: CalloutBlock }) {
  const style = CALLOUT_STYLES[block.variant]
  const Icon = style.icon
  return (
    <div className={`flex gap-3 rounded-md border px-4 py-3 ${style.container}`}>
      <Icon className={`mt-0.5 size-5 shrink-0 ${style.iconClass}`} aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{block.title}</p>
        <p className="text-sm leading-relaxed">{block.text}</p>
      </div>
    </div>
  )
}

const SEVERITY_STYLES = {
  low: 'bg-yellow-100 text-yellow-800',
  medium: 'bg-orange-100 text-orange-800',
  high: 'bg-red-100 text-red-800',
  critical: 'bg-red-600 text-white',
} as const

const CONTROL_LABELS = { engineering: 'Engineering', administrative: 'Administrative', ppe: 'PPE' } as const

// The safety-critical block — deliberately the highest-contrast treatment in
// the set (Jacques review note: hazard/callout legibility matters most here).
export function HazardBlockView({ block }: { block: HazardBlock }) {
  return (
    <div className="space-y-3 rounded-md border-2 border-destructive bg-destructive/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-6 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-lg font-bold text-destructive">{block.hazard}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${SEVERITY_STYLES[block.severity]}`}
        >
          {block.severity}
        </span>
      </div>
      <p className="text-base leading-relaxed">{block.description}</p>
      <ul className="space-y-2">
        {block.controls.map((control, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase">
              {CONTROL_LABELS[control.type]}
            </span>
            <span className="leading-relaxed">{control.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ImageBlockView({ block, url }: { block: ImageBlock; url: string | null }) {
  return (
    <figure className="space-y-2">
      {url ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
          {/* Signed Storage URLs are short-lived and per-request — unoptimized
              skips next/image's optimizer, which can't authenticate to fetch them. */}
          <Image src={url} alt={block.alt} fill unoptimized className="object-cover" />
        </div>
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed bg-muted text-sm text-muted-foreground">
          Image unavailable
        </div>
      )}
      {block.caption && <figcaption className="text-sm text-muted-foreground">{block.caption}</figcaption>}
    </figure>
  )
}

export function VideoBlockView({
  block,
  url,
  posterUrl,
}: {
  block: VideoBlock
  url: string | null
  posterUrl: string | null
}) {
  return (
    <figure className="space-y-2">
      {url ? (
        <video controls poster={posterUrl ?? undefined} className="w-full rounded-md bg-black">
          <source src={url} />
        </video>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md border border-dashed bg-muted text-sm text-muted-foreground">
          Video unavailable
        </div>
      )}
      {block.caption && <figcaption className="text-sm text-muted-foreground">{block.caption}</figcaption>}
    </figure>
  )
}

export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <figure className="space-y-2">
      <div className="w-full overflow-x-auto rounded-md border">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-muted">
            <tr>
              {block.headers.map((header, i) => (
                <th key={i} className="px-3 py-2 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-t">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {block.caption && <figcaption className="text-sm text-muted-foreground">{block.caption}</figcaption>}
    </figure>
  )
}

export function UnknownBlockPlaceholder({ index, type, reason }: { index: number; type: string; reason: string }) {
  if (process.env.NODE_ENV === 'production') return null
  return (
    <div className="rounded-md border-2 border-dashed border-amber-500 bg-amber-500/10 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Unknown block at index {index}: &quot;{type}&quot;</p>
      <p className="text-amber-800">{reason}</p>
    </div>
  )
}
