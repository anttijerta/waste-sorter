import { Head } from '@inertiajs/react'
import { type ChangeEvent, useEffect, useState } from 'react'
import { type InertiaProps } from '~/types'
import DefaultLayout from '~/layouts/default'
import { downscaleToJpeg } from '~/lib/downscale'
import { type ClassifyResponse, ClassifyError, classifyImage } from '~/lib/api'

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: ClassifyResponse }
  | { status: 'error'; message: string }

const usd = new Intl.NumberFormat('fi-FI', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})

function formatCost(value: number | null): string {
  return value === null ? '–' : usd.format(value)
}

/** Running cost per model, in the same order as `result.models`. */
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
        a + (result.models[0].costUsd ?? 0),
        b + (result.models[1].costUsd ?? 0),
      ])
    } catch (error) {
      const message =
        error instanceof ClassifyError ? error.message : 'Kuvan käsittely epäonnistui.'
      setState({ status: 'error', message })
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
            {state.status === 'error' && (
              <p className="banner banner--error" role="alert" data-testid="error">
                {state.message}
              </p>
            )}
            {state.status === 'done' && (
              <Results result={state.result} sessionTotals={sessionTotals} />
            )}
          </div>
        </section>
      )}

      {!previewUrl && state.status === 'error' && (
        <p className="banner banner--error" role="alert" data-testid="error">
          {state.message}
        </p>
      )}
    </>
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
      values: models.map((model) => model.costUsd),
    },
    { label: 'Istunto yhteensä', testId: 'cost-session', values: sessionTotals },
    {
      label: '1 000 kuvaa maksaisi',
      testId: 'cost-1000',
      values: models.map((model) => (model.costUsd === null ? null : model.costUsd * 1000)),
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
                  <td key={index} className="num" data-usd={value ?? ''}>
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
