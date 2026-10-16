/**
 * The latest eval results shown on the page, one per labels file. Update
 * after each eval run: `node ace eval --yes --runs=3` for the test set and
 * the same with `--labels=labels-holdout.csv` for the holdout. A unit test
 * checks that promptSha256 matches the current prompt, so a prompt change
 * cannot leave stale numbers here.
 *
 * `images` counts scored images only (oos excluded). `accuracy` is the mean
 * over the runs, easy and hard images.
 */
export const EVAL_SUMMARY = {
  promptSha256: 'a89bb9a59166199817722c454066876ffe7ab739d34a86a41f869a33dd2223ad',
  testSet: {
    date: '2026-10-14',
    images: 24,
    runs: 3,
    models: [
      { modelId: 'gpt-6-luna', accuracy: 0.82 },
      { modelId: 'gpt-6.1-sol', accuracy: 0.97 },
    ],
  },
  holdout: {
    date: '2026-10-15',
    images: 11,
    runs: 3,
    models: [
      { modelId: 'gpt-6-luna', accuracy: 0.88 },
      { modelId: 'gpt-6.1-sol', accuracy: 1 },
    ],
  },
} as const

export type EvalSummary = typeof EVAL_SUMMARY
export type EvalSetSummary = EvalSummary['testSet'] | EvalSummary['holdout']
