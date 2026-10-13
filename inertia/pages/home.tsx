import { Head } from '@inertiajs/react'
import { type ChangeEvent, useEffect, useState } from 'react'
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

function imageCost(result: ClassifyResponse): number {
  return result.models.reduce((sum, model) => sum + (model.costUsd ?? 0), 0)
}

export default function Home() {
  const [state, setState] = useState<State>({ status: 'idle' })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [session, setSession] = useState({ images: 0, totalUsd: 0 })

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
      setSession((previous) => ({
        images: previous.images + 1,
        totalUsd: previous.totalUsd + imageCost(result),
      }))
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
            {state.status === 'done' && <Results result={state.result} session={session} />}
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
  session,
}: {
  result: ClassifyResponse
  session: { images: number; totalUsd: number }
}) {
  const perImage = imageCost(result)

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
              <th scope="col">Luokka</th>
              <th scope="col" className="num">
                Viive
              </th>
              <th scope="col" className="num">
                Hinta
              </th>
            </tr>
          </thead>
          <tbody>
            {result.models.map((model) => (
              <tr key={model.modelId}>
                <td className="mono">{model.modelId}</td>
                <td>
                  {model.label}
                  {model.error && <span className="row-error"> ({model.error})</span>}
                </td>
                <td className="num">{model.latencyMs} ms</td>
                <td className="num">{formatCost(model.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="costs" data-testid="costs">
        <div>
          <dt>Tämä kuva</dt>
          <dd>{usd.format(perImage)}</dd>
        </div>
        <div>
          <dt>Istunto yhteensä ({session.images} kuvaa)</dt>
          <dd data-testid="session-total">{usd.format(session.totalUsd)}</dd>
        </div>
        <div>
          <dt>1 000 kuvaa maksaisi</dt>
          <dd>{usd.format(perImage * 1000)}</dd>
        </div>
      </dl>
    </>
  )
}

Home.layout = [DefaultLayout]
