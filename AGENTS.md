# waste-sorter

Public portfolio demo. The user uploads a photo of an item and two LLMs
classify it into a fixed set of Helsinki (HSY) waste categories. The UI shows
whether the models agree, plus latency and cost per model. The AI is hidden:
the user only uploads an image and sees results.

## Stack

- AdonisJS v7 + Inertia + React + TypeScript
- SQLite for usage counters
- Single Docker container, listens on `PORT`, exposes `GET /health`
- Deployed by a separate private `infra` repo. Do not add server or
  deployment config here beyond the Dockerfile and the CI workflow.

## Language

- Code, identifiers, comments, commit messages: English
- UI text: Finnish (category labels below)
- README: English

## Categories

Create `config/categories.ts` from this list. It is the single source of
truth. Source: HSY sorting guide (Helsinki region).

| id           | label            |
| ------------ | ---------------- |
| bio          | Biojäte          |
| cardboard    | Kartonki         |
| paper        | Paperi           |
| glass        | Lasi             |
| metal        | Metalli          |
| plastic      | Muovi            |
| mixed        | Sekajäte         |
| hazardous    | Vaarallinen jäte |
| electronics  | Sähkölaitteet    |
| textile      | Tekstiili        |
| unrecognized | Ei tunnistettu   |

## Product rules

- Images are downscaled in the browser (max 1024 px, JPEG via canvas
  re-encode, which also strips EXIF). The server re-validates size and type.
- Images are never stored or logged. Store only counters and anonymous metrics.
- Rate limiting uses a hashed IP, never the raw IP: HMAC-SHA256 with
  `APP_KEY`, with the UTC date in the message so hashes cannot be linked
  across days. Usage rows are deleted after 35 days.
- Usage is reserved before the models are called, so concurrent requests
  cannot exceed a limit. Failed calls still count.
- Both models are called in parallel with the same prompt, image and
  settings (OpenAI Responses API, `store: false`, no automatic retries).
- Tests and CI never call the real API: the test environment always uses
  the mock classifiers.
- Models must return one category id from the list above, as structured
  output. Anything else is treated as `unrecognized`.
- Same category from both → agreement (green). Different → show both.
- While the mock classifier is active, the UI shows a clear demo mode
  label ("Demotila: mallit ovat simuloituja") so results are not mistaken
  for real classifications.
- Cost per call = token usage from the API response (reasoning tokens
  included) × price table in `config/pricing.ts`. The table includes the
  date prices were checked. Costs are integer micro-euros everywhere.
- Show, per model: cost per image, total for the session, and "1,000 images
  would cost". Every figure belongs to exactly one model; no combined totals.

## Configuration (environment variables)

- `MODEL_A`, `MODEL_B`: model ids (default `gpt-6-luna`, `gpt-6.1-sol`)
- `MODEL_API_KEY`: never in code, images, logs or the repo. Empty means demo
  mode with mock classifiers.
- `MODEL_REASONING_EFFORT` (default `low`): one value for both models,
  validated per model at startup
- `MODEL_TIMEOUT_MS` (default 20000): per call, no automatic retries
- `DB_PATH`: SQLite file, default `/app/data/db.sqlite3`. Never inside `tmp/`.
- `RATE_LIMIT_PER_IP_PER_MINUTE` (default 5), `RATE_LIMIT_PER_IP_DAILY`
  (default 20)
- `GLOBAL_MONTHLY_CAP_EUR` (default 5): estimated spend from
  `config/pricing.ts`, not an image count
- `TRUSTED_PROXIES`: comma-separated IPs/CIDRs of the reverse proxy, the
  only source allowed to set `X-Forwarded-For`. Empty (default) trusts
  nobody. The infra Compose network must use a fixed subnet
  (`ipam.config.subnet`): Docker assigns subnets dynamically and they can
  change when containers are recreated. Never publish the app port
  directly, or clients reach it through Docker NAT.
- `EVAL_DATA_DIR`: path to test images and `labels.csv`, outside this repo.
  Never copy eval images into the repo. Layout: `labels.csv`
  (`file,expected,difficulty,note`), photos in `images-jpg/`, results
  written to `results/`. `node ace eval` makes paid calls and requires
  `--yes`; never run it in CI.

## Build order (do not skip ahead)

1. Skeleton with a mock classifier: no API key, no external calls
2. Docker image + CI workflow that pushes to GHCR
3. Usage caps: per IP and global monthly
4. Real model calls
5. Eval script over `EVAL_DATA_DIR`, UI polish, "show what happened" view

Step 3 must also (done):

- Move the SQLite file out of `tmp/` into its own `data/` directory
  (e.g. `/app/data/db.sqlite3` in the container), configurable via an
  env variable (e.g. `DB_PATH`). The database must not share a directory
  with temporary files.

Step 4 must also (done):

- Fall back to the mock classifier when `MODEL_API_KEY` is missing.
- Keep the demo mode label (already in place) tied to the fallback: it
  shows whenever any model is simulated and disappears with real models.
- Add a "Configuration" section to the README: an env var table, how to
  get your own key, and a recommendation to set a spend cap at the
  provider.

At launch: add links to the live demo and the blog post, plus a
screenshot or GIF, at the top of the README.

## Constraints

- One server, Docker Compose. No Kubernetes, no IaC.
- Tests: Vitest for logic, Playwright for the main upload flow.
- Secret scanning runs as a pre-commit hook (`.githooks/`). Never bypass it
  with `--no-verify`.
- Small commits, one concern each.
