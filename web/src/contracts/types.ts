// Shared TS types mirrored from orientation_pipeline_contracts_v0.1.md §5.
// This is the source of truth for the pipeline's shapes across the app —
// import from here rather than redeclaring JobStatus/JobRecord/etc. locally.
// Keep this file in sync by hand whenever the contract doc changes.
//
// §5 references SourceAsset, QAHistoryEntry, and JobError without declaring
// them inline; their shapes below are taken from the §2 job-record JSON example.

export type ULID = string
export type Sha256 = string

export interface ArtifactRef {
  storage_key: string
  sha256: Sha256
  produced_at?: string
}

export interface SourceAsset {
  storage_key: string
  filename: string
  mime: string
  sha256: Sha256
  uploaded_by: string
  uploaded_at: string
}

export type JobStatus =
  | 'queued'
  | 'extracting'
  | 'structuring'
  | 'generating_quiz'
  | 'qa_review'
  | 'awaiting_approval'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled'

export interface QAHistoryEntry {
  attempt: number
  verdict: 'pass' | 'needs_rework'
  routed_to: 'structure' | 'generate_quiz' | 'none'
  open_issue_count: number
  produced_at: string
}

export interface JobError {
  stage: JobStatus
  code: string
  message: string
  retryable: boolean
  occurred_at: string
}

export interface JobRecord {
  id: ULID
  site_id: string
  org_id: string
  status: JobStatus
  current_stage: JobStatus
  rework_count: number
  max_rework: number
  qa_flagged: boolean
  source_asset: SourceAsset
  artifacts: Partial<Record<'extracted_deck' | 'content_model' | 'quiz', ArtifactRef>>
  qa_history: QAHistoryEntry[]
  error: JobError | null
  package_id: ULID | null
  package_version: number | null
  approved_by: string | null
  approved_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  idempotency_key: string
}

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'key_point'
  | 'callout'
  | 'hazard'
  | 'image'
  | 'video'
  | 'table'

export interface SourceRef {
  slide_index: number
  shape_index?: number
}

export interface ContentBlock {
  id: ULID
  type: BlockType
  source_ref: SourceRef
  [field: string]: unknown // type-specific fields, narrowed per BlockType
}

export interface HazardBlock extends ContentBlock {
  type: 'hazard'
  hazard: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  controls: { type: 'engineering' | 'administrative' | 'ppe'; text: string }[]
}

// The remaining eight block types from the closed set (contracts §4.3). Each
// narrows ContentBlock the same way HazardBlock does above. Adding a type
// here means deliberately updating the renderer and validate.ts too — see
// CLAUDE.md §5 "Closed block-type set".
export interface HeadingBlock extends ContentBlock {
  type: 'heading'
  level: 1 | 2 | 3
  text: string
}

export interface ParagraphBlock extends ContentBlock {
  type: 'paragraph'
  text: string
}

export interface ListBlock extends ContentBlock {
  type: 'list'
  ordered: boolean
  items: string[]
}

export interface KeyPointBlock extends ContentBlock {
  type: 'key_point'
  text: string
}

export interface CalloutBlock extends ContentBlock {
  type: 'callout'
  variant: 'info' | 'warning' | 'critical'
  title: string
  text: string
}

export interface ImageBlock extends ContentBlock {
  type: 'image'
  asset_id: string
  alt: string
  caption?: string
}

export interface VideoBlock extends ContentBlock {
  type: 'video'
  asset_id: string
  caption?: string
  poster_asset_id?: string
}

export interface TableBlock extends ContentBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
  caption?: string
}

// What the renderer actually receives once a raw ContentBlock has passed
// validate.ts and been narrowed to one of the nine known shapes.
export type ValidatedBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | KeyPointBlock
  | CalloutBlock
  | HazardBlock
  | ImageBlock
  | VideoBlock
  | TableBlock

export interface LearningObjective {
  id: ULID
  text: string
  source_block_ids: ULID[]
}

export interface Module {
  id: ULID
  order: number
  title: string
  source_slides: number[]
  learning_objectives: LearningObjective[]
  blocks: ContentBlock[]
}

export interface HazardIndexEntry {
  block_id: ULID
  module_id: ULID
  hazard: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface Branding {
  colors: { primary: string; secondary: string; accent: string }
  fonts: { heading: string; body: string }
  logo_asset_id: string | null
}

export interface ContentModelMeta {
  title: string
  site_id: string
  language: string
  estimated_minutes: number
  reading_level: string
}

export interface ContentModel {
  meta: ContentModelMeta
  branding: Branding
  modules: Module[]
  hazard_index: HazardIndexEntry[]
}

export interface QuizQuestion {
  id: ULID
  module_id: ULID
  objective_id: ULID
  source_refs: ULID[]
  type: 'single_choice' | 'multi_choice' | 'true_false'
  difficulty: 'recall' | 'application'
  stem: string
  options: { id: string; text: string }[]
  correct_option_ids: string[]
  rationale: string
}

export interface QuizMeta {
  pass_threshold: number
  attempts_allowed: number
  shuffle_questions: boolean
  shuffle_options: boolean
  question_count: number
}

export interface Quiz {
  meta: QuizMeta
  questions: QuizQuestion[]
  coverage_map: Record<ULID, ULID[]>
}

export type RequalificationPolicy = 'full' | 'new_content_only' | 'none'

// Platform-side columns (HowDesign-DataModel.md §3.2) over the contract's
// OrientationPackage shape (contracts §4.6).
export interface OrientationPackage {
  id: ULID
  org_id: string
  site_id: string
  version: number
  supersedes_id: ULID | null
  content_model_ref: ArtifactRef
  quiz_ref: ArtifactRef
  asset_manifest: { asset_id: string; storage_key: string; mime: string }[]
  content_hash: string
  requalification_policy: RequalificationPolicy
  qa_flagged: boolean
  status: 'published' | 'archived'
  approved_by: string
  approved_at: string
  published_at: string
  created_at: string
}

export interface QAIssue {
  id: ULID
  severity: 'blocker' | 'major' | 'minor'
  category: 'coverage' | 'correctness' | 'fidelity' | 'accessibility'
  target_stage: 'structure' | 'generate_quiz'
  target_ref: ULID
  description: string
  suggested_fix: string
}

export interface QAVerdict {
  verdict: 'pass' | 'needs_rework'
  scores: Record<'coverage' | 'correctness' | 'fidelity', { value: number; pass: boolean }>
  issues: QAIssue[]
  routed_to: 'structure' | 'generate_quiz' | 'none'
  decision: 'proceed' | 'rework' | 'escalate'
  rework_count: number
  max_rework: number
}
