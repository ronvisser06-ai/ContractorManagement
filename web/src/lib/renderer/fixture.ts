// Canned ContentModel for the Step 4 renderer preview (Feature2-Pipeline-Skeleton-Brief.md).
// Deliberately NOT derived from a real extracted deck — structuring is still
// stubbed (M2 brings real AI-structured content). This exercises all nine
// closed block types plus one deliberately invalid type, so the preview also
// proves the unknown-block rejection path.
//
// Typed `unknown` rather than ContentModel: it's meant to represent JSON as it
// would arrive from Storage (untrusted), including the one intentionally
// broken block — validation happens per-block at render time, not here.
export const fixtureContentModel: unknown = {
  meta: {
    title: 'Site Safety Orientation (Preview Fixture)',
    site_id: 'site_fixture_01',
    language: 'en',
    estimated_minutes: 18,
    reading_level: 'grade_8',
  },
  branding: {
    colors: { primary: '#012A4A', secondary: '#2A9D8F', accent: '#F4A261' },
    fonts: { heading: 'Inter', body: 'Inter' },
    logo_asset_id: null,
  },
  modules: [
    {
      id: 'mod_01',
      order: 1,
      title: 'Welcome & Site Overview',
      source_slides: [1, 2],
      learning_objectives: [],
      blocks: [
        {
          id: 'blk_01_01',
          type: 'heading',
          level: 2,
          text: 'Why This Orientation Matters',
          source_ref: { slide_index: 1 },
        },
        {
          id: 'blk_01_02',
          type: 'paragraph',
          text: 'Every contractor must complete this orientation before being granted site access. It covers the hazards, rules, and emergency procedures specific to this location.',
          source_ref: { slide_index: 1 },
        },
        {
          id: 'blk_01_03',
          type: 'key_point',
          text: 'You must pass the end-of-orientation quiz before your QR access pass is issued.',
          source_ref: { slide_index: 1 },
        },
        {
          id: 'blk_01_04',
          type: 'list',
          ordered: false,
          items: ['Hard hat and safety boots required at all times', 'No smoking outside designated areas', 'Report all incidents to your foreman immediately'],
          source_ref: { slide_index: 2 },
        },
        {
          id: 'blk_01_05',
          type: 'image',
          asset_id: 'ast_fixture_site_overview',
          alt: 'Aerial view of the site',
          caption: 'Main site layout — gate, laydown yard, and admin trailer',
          source_ref: { slide_index: 2 },
        },
        {
          id: 'blk_01_06',
          type: 'callout',
          variant: 'info',
          title: 'Sign-in required',
          text: 'All workers must sign in at the gate kiosk at the start of every shift.',
          source_ref: { slide_index: 2 },
        },
      ],
    },
    {
      id: 'mod_02',
      order: 2,
      title: 'Confined Space Entry',
      source_slides: [5, 6, 7],
      learning_objectives: [
        {
          id: 'obj_02_1',
          text: 'State the conditions required before entering a confined space.',
          source_block_ids: ['blk_02_02', 'blk_02_03'],
        },
      ],
      blocks: [
        {
          id: 'blk_02_01',
          type: 'heading',
          level: 2,
          text: 'Confined Space Entry',
          source_ref: { slide_index: 5 },
        },
        {
          id: 'blk_02_02',
          type: 'paragraph',
          text: 'A confined space has limited entry/exit and is not designed for continuous occupancy. Entry without following procedure has caused fatalities on similar sites.',
          source_ref: { slide_index: 5 },
        },
        {
          id: 'blk_02_03',
          type: 'hazard',
          hazard: 'Oxygen-deficient atmosphere',
          description: 'Entering before the atmosphere is tested can cause loss of consciousness within seconds and is frequently fatal.',
          severity: 'critical',
          controls: [
            { type: 'engineering', text: 'Continuous gas monitoring during entry.' },
            { type: 'administrative', text: 'Permit re-validated every shift, no exceptions.' },
            { type: 'ppe', text: 'Supplied-air respirator on standby at the entry point.' },
          ],
          source_ref: { slide_index: 5, shape_index: 2 },
        },
        {
          id: 'blk_02_04',
          type: 'callout',
          variant: 'warning',
          title: 'Test before entry',
          text: 'Atmosphere must be tested and logged before anyone enters, even for a "quick look."',
          source_ref: { slide_index: 6 },
        },
        {
          id: 'blk_02_05',
          type: 'callout',
          variant: 'critical',
          title: 'No permit, no entry',
          text: 'Never enter a confined space without a current, signed permit. This applies to every worker, every time.',
          source_ref: { slide_index: 6 },
        },
        {
          id: 'blk_02_06',
          type: 'list',
          ordered: true,
          items: ['Obtain and review the entry permit', 'Test the atmosphere and record results', 'Post an attendant at the entry point', 'Don required PPE before entry'],
          source_ref: { slide_index: 6 },
        },
        {
          id: 'blk_02_07',
          type: 'table',
          headers: ['Hazard', 'Control'],
          rows: [
            ['Oxygen deficiency', 'Continuous gas monitoring'],
            ['Engulfment', 'Lockout of feed lines before entry'],
          ],
          caption: 'Summary of confined-space hazards and controls',
          source_ref: { slide_index: 7 },
        },
        {
          id: 'blk_02_08',
          type: 'video',
          asset_id: 'ast_fixture_confined_space_video',
          caption: 'Confined space entry walkthrough (no source file in this preview fixture)',
          source_ref: { slide_index: 7 },
        },
        {
          id: 'blk_02_09',
          type: 'image',
          asset_id: 'ast_fixture_confined_space',
          alt: 'Confined space entry warning sign',
          source_ref: { slide_index: 7 },
        },
        {
          // Deliberately invalid: not in the closed block-type set (contracts §4.3).
          // Proves the renderer rejects it gracefully rather than crashing or
          // rendering raw markup — visible placeholder in dev, dropped in prod.
          id: 'blk_02_10',
          type: 'carousel',
          slides: ['a', 'b', 'c'],
          source_ref: { slide_index: 7 },
        },
      ],
    },
  ],
  hazard_index: [
    { block_id: 'blk_02_03', module_id: 'mod_02', hazard: 'Oxygen-deficient atmosphere', severity: 'critical' },
  ],
}

export const fixtureAssetManifest: { asset_id: string; storage_key: string }[] = [
  { asset_id: 'ast_fixture_site_overview', storage_key: 'fixtures/content-model-preview/ast_fixture_site_overview.jpg' },
  { asset_id: 'ast_fixture_confined_space', storage_key: 'fixtures/content-model-preview/ast_fixture_confined_space.jpg' },
  // ast_fixture_confined_space_video is deliberately absent — exercises the
  // VideoBlockView "Video unavailable" fallback (no real clip in this fixture).
]
