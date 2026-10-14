import { Head } from '@inertiajs/react'
import { type ChangeEvent, useEffect, useState } from 'react'
import { type InertiaProps } from '~/types'
import DefaultLayout from '~/layouts/default'
import { downscaleToJpeg } from '~/lib/downscale'
import { type ClassifyResponse, type LimitReason, ClassifyError, classifyImage } from '~/lib/api'

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: ClassifyResponse }
  | { status: 'error'; message: string; limit: LimitReason | null }

const eur = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

/** Costs arrive as integer micro-euros. */
function formatCost(microEur: number | null): string {
  return microEur === null ? '–' : eur.format(microEur / 1_000_000)
}

/** Running cost per model in micro-euros, in the same order as `result.models`. */
type SessionTotals = [number, number]

export default function Home({ demoMode }: InertiaProps<{ demoMode: boolean }>) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sessionTotals, setSessionTotals] = useState<SessionTotals>([0, 0])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setState({ status: 'loading' })
    try {
      const jpeg = await downscaleToJpeg(file)
      setPreviewUrl(URL.createObjectURL(jpeg))
      const result = await classifyImage(jpeg)
      setState({ status: 'done', result })
      setSessionTotals(([a, b]) => [
        a + (result.models[0].costMicroEur ?? 0),
        b + (result.models[1].costMicroEur ?? 0),
      ])
    } catch (error) {
      if (error instanceof ClassifyError) {
        setState({ status: 'error', message: error.message, limit: error.limit })
      } else {
        setState({ status: 'error', message: 'Kuvan käsittely epäonnistui.', limit: null })
      }
    }
  }

  const loading = state.status === 'loading'

  return (
    <>
      <Head title="Lajittele jäte" />

      {demoMode && (
        <p className="banner banner--demo" role="status" data-testid="demo-mode">
          <strong>Demotila: mallit ovat simuloituja.</strong> Tulokset eivät ole oikeita
          luokitteluja.
        </p>
      )}

      <section className="card">
        <h1 className="card__title">Mihin roska kuuluu?</h1>
        <p className="muted">
          Ota kuva esineestä tai valitse kuva laitteeltasi. Kaksi mallia arvioi, mihin HSY:n
          jäteastiaan se kuuluu.
        </p>

        <label className={`btn btn--primary upload ${loading ? 'is-disabled' : ''}`}>
          {loading ? 'Luokitellaan…' : 'Valitse kuva'}
          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            disabled={loading}
            data-testid="image-input"
            className="visually-hidden"
          />
        </label>
        <p className="hint">Kuva pienennetään selaimessa eikä sitä tallenneta.</p>
      </section>

      {previewUrl && (
        <section className="card card--row">
          <img src={previewUrl} alt="Lähetetty kuva" className="preview" />
          <div className="card__body">
            {state.status === 'loading' && <p className="muted">Luokitellaan…</p>}
            {state.status === 'error' && <ErrorBanner {...state} />}
            {state.status === 'done' && (
              <Results result={state.result} sessionTotals={sessionTotals} />
            )}
          </div>
        </section>
      )}

      {!previewUrl && state.status === 'error' && <ErrorBanner {...state} />}
    </>
  )
}

/**
 * A hit usage limit is not the user's fault: the monthly cap pauses the
 * whole demo, so it gets a neutral style instead of the error colour.
 */
function ErrorBanner({ message, limit }: { message: string; limit: LimitReason | null }) {
  if (!limit) {
    return (
      <p className="banner banner--error" role="alert" data-testid="error">
        {message}
      </p>
    )
  }
  return (
    <p
      className={`banner ${limit === 'monthly_cap' ? 'banner--paused' : 'banner--disagree'}`}
      role="alert"
      data-testid="limit-error"
      data-code={limit}
    >
      {message}
    </p>
  )
}

function Results({
  result,
  sessionTotals,
}: {
  result: ClassifyResponse
  sessionTotals: SessionTotals
}) {
  const { models } = result

  /**
   * One column per model, so every figure belongs to exactly one model.
   */
  const costRows: { label: string; testId: string; values: (number | null)[] }[] = [
    {
      label: 'Hinta tälle kuvalle',
      testId: 'cost-image',
      values: models.map((model) => model.costMicroEur),
    },
    { label: 'Istunto yhteensä', testId: 'cost-session', values: sessionTotals },
    {
      label: '1 000 kuvaa maksaisi',
      testId: 'cost-1000',
      values: models.map((model) =>
        model.costMicroEur === null ? null : model.costMicroEur * 1000
      ),
    },
  ]

  return (
    <>
      {result.agreement.agreed ? (
        <p className="banner banner--agree" data-testid="agreement" data-agreed="true">
          Mallit ovat samaa mieltä: <strong>{result.agreement.label}</strong>
        </p>
      ) : (
        <p className="banner banner--disagree" data-testid="agreement" data-agreed="false">
          Mallit ovat eri mieltä
        </p>
      )}

      <div className="table-wrap">
        <table className="results" data-testid="results">
          <thead>
            <tr>
              <th scope="col">Malli</th>
              {models.map((model, index) => (
                <th key={index} scope="col" className="mono num">
                  {model.modelId}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr data-testid="category">
              <th scope="row">Luokka</th>
              {models.map((model, index) => (
                <td key={index} className="num">
                  {model.label}
                  {model.error && <span className="row-error"> ({model.error})</span>}
                </td>
              ))}
            </tr>
            <tr data-testid="latency">
              <th scope="row">Viive</th>
              {models.map((model, index) => (
                <td key={index} className="num">
                  {model.latencyMs} ms
                </td>
              ))}
            </tr>
            {costRows.map((row) => (
              <tr key={row.testId} data-testid={row.testId}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, index) => (
                  <td key={index} className="num" data-micro-eur={value ?? ''}>
                    {formatCost(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

Home.layout = [DefaultLayout]
