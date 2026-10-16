/**
 * The latest eval result shown on the page. Update after each eval run
 * (node ace eval --yes --runs=3). A unit test checks that promptSha256 matches
 * the current prompt, so a prompt change cannot leave stale numbers here.
 */
export const EVAL_SUMMARY = {
  date: '2026-10-15',
  promptSha256: 'a89bb9a59166199817722c454066876ffe7ab739d34a86a41f869a33dd2223ad',
  images: 24,
  runs: 3,
  /** Mean accuracy over the runs, easy and hard images (oos excluded) */
  models: [
    { modelId: 'gpt-6-luna', accuracy: 0.82 },
    { modelId: 'gpt-6.1-sol', accuracy: 0.97 },
  ],
} as const

export type EvalSummary = typeof EVAL_SUMMARY
