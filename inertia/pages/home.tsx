import { Head } from '@inertiajs/react'
import { type ChangeEvent, useEffect, useState } from 'react'
import { type InertiaProps } from '~/types'
import DefaultLayout from '~/layouts/default'
import { type ImageSize, downscaleToJpeg } from '~/lib/downscale'
import {
  type ClassifyApiResponse,
  type LimitReason,
  type RequestSettings,
  ClassifyError,
  classifyImage,
} from '~/lib/api'

/** Sizes measured in the browser before upload */
type BrowserStep = { original: ImageSize; prepared: ImageSize }

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: ClassifyApiResponse; browser: BrowserStep }
  | { status: 'error'; message: string; limit: LimitReason | null }

type EvalSetProps = {
  date: string
  images: number
  runs: number
  models: { modelId: string; accuracy: number }[]
}

type HomeProps = {
  demoMode: boolean
  requestSettings: RequestSettings
  /** First 7 hex characters of the live prompt's SHA-256 */
  promptVersion: string
  evalSummary: { testSet: EvalSetProps; holdout: EvalSetProps }
}

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

const integer = new Intl.NumberFormat('fi-FI')

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toLocaleString('fi-FI', { maximumFractionDigits: 1 })} Mt`
    : `${Math.round(bytes / 1024)} kt`
}

function formatDate(isoDay: string): string {
  const [year, month, day] = isoDay.split('-').map(Number)
  return `${day}.${month}.${year}`
}

/** "gpt-6-luna noin 82 %, gpt-6.1-sol 100 %": a perfect score is exact. */
function formatAccuracies(models: EvalSetProps['models']): string {
  return models
    .map((model) => {
      const percent = Math.round(model.accuracy * 100)
      return `${model.modelId} ${percent === 100 ? '' : 'noin '}${percent} %`
    })
    .join(', ')
}

export default function Home({
  demoMode,
  requestSettings,
  promptVersion,
  evalSummary,
}: InertiaProps<HomeProps>) {
  const { testSet, holdout } = evalSummary
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
      const { jpeg, original, prepared } = await downscaleToJpeg(file)
      setPreviewUrl(URL.createObjectURL(jpeg))
      const result = await classifyImage(jpeg)
      setState({ status: 'done', result, browser: { original, prepared } })
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
        <p className="hint" data-testid="hsy-note">
          Luokat noudattavat HSY:n lajitteluohjetta (pääkaupunkiseutu).
        </p>
        <p className="hint" data-testid="eval-summary">
          <span data-testid="eval-test-set">
            Testattu {testSet.images} kuvalla, {testSet.runs} kierrosta:{' '}
            {formatAccuracies(testSet.models)} oikein ({formatDate(testSet.date)}).
          </span>{' '}
          <span data-testid="eval-holdout">
            Erillisellä varmistusjoukolla ({holdout.images} kuvaa, {holdout.runs} kierrosta):{' '}
            {formatAccuracies(holdout.models)} oikein ({formatDate(holdout.date)}).
          </span>{' '}
          <span data-testid="eval-prompt-version">
            Ohjeversio <span className="mono">{promptVersion}</span>.
          </span>
        </p>
      </section>

      {previewUrl && (
        <section className="card card--row">
          <img src={previewUrl} alt="Lähetetty kuva" className="preview" />
          <div className="card__body">
            {state.status === 'loading' && <p className="muted">Luokitellaan…</p>}
            {state.status === 'error' && <ErrorBanner {...state} />}
            {state.status === 'done' && (
              <>
                <Results result={state.result} sessionTotals={sessionTotals} />
                <WhatHappened
                  result={state.result}
                  browser={state.browser}
                  settings={requestSettings}
                  promptVersion={promptVersion}
                />
              </>
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
  result: ClassifyApiResponse
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

/**
 * Step by step, what happened to the photo and what each model did.
 * Collapsed by default.
 */
function WhatHappened({
  result,
  browser,
  settings,
  promptVersion,
}: {
  result: ClassifyApiResponse
  browser: BrowserStep
  settings: RequestSettings
  promptVersion: string
}) {
  const { original, prepared } = browser
  const effort = (modelId: string) =>
    settings.models.find((model) => model.modelId === modelId)?.reasoningEffort ?? null
  const resized = original.width !== prepared.width || original.height !== prepared.height

  return (
    <details className="details" data-testid="what-happened">
      <summary>Näytä mitä tapahtui</summary>
      <ol className="steps">
        <li data-testid="step-prepare">
          <strong>Kuvan valmistelu.</strong>{' '}
          {resized
            ? `Selain pienensi kuvan ${original.width}×${original.height} px (${formatBytes(original.bytes)}) kokoon ${prepared.width}×${prepared.height} px (${formatBytes(prepared.bytes)}, JPEG).`
            : `Kuva oli jo enintään 1024 px (${original.width}×${original.height} px), joten selain vain tallensi sen uudelleen JPEG-muotoon (${formatBytes(original.bytes)} → ${formatBytes(prepared.bytes)}).`}{' '}
          Metatiedot, kuten sijainti, poistettiin selaimessa ja vielä palvelimella
          {result.image.metadataBytesRemoved > 0
            ? ` (palvelin poisti ${integer.format(result.image.metadataBytesRemoved)} tavua)`
            : ''}
          .
        </li>
        <li data-testid="step-sent">
          <strong>Malleille lähetettiin</strong> sama kuva ({result.image.width}×
          {result.image.height} px, {formatBytes(result.image.bytes)}) ja sama ohje (versio{' '}
          <span className="mono" data-testid="sent-prompt-version">
            {promptVersion}
          </span>
          ):
          <ul>
            {result.models.map((model) => (
              <li key={model.modelId}>
                <span className="mono">{model.modelId}</span>:{' '}
                {effort(model.modelId) ? `päättelytaso ${effort(model.modelId)}, ` : ''}
                enintään {settings.maxOutputTokens} vastaustokenia
              </li>
            ))}
          </ul>
          <details className="details details--nested">
            <summary>Näytä ohje</summary>
            <pre className="prompt" data-testid="prompt">
              {settings.prompt}
            </pre>
          </details>
        </li>
        <li data-testid="step-answers">
          <strong>Vastaukset.</strong>
          <ul>
            {result.models.map((model) => (
              <li key={model.modelId} data-testid="answer-row">
                <span className="mono">{model.modelId}</span>: <strong>{model.label}</strong>
                {model.error && <span className="row-error"> ({model.error})</span>}
                <br />
                <span data-testid="answer-tokens">
                  {model.usage
                    ? `${integer.format(model.usage.inputTokens)} syötetokenia${
                        model.usage.cachedInputTokens > 0
                          ? ` (välimuistista ${integer.format(model.usage.cachedInputTokens)})`
                          : ''
                      }, ${integer.format(model.usage.outputTokens)} vastaustokenia${
                        model.usage.reasoningTokens > 0
                          ? ` (päättely ${integer.format(model.usage.reasoningTokens)})`
                          : ''
                      }`
                    : 'tokenit eivät tiedossa'}
                </span>
                {' · '}
                <span data-testid="answer-cost">{formatCost(model.costMicroEur)}</span>
                {' · '}
                <span data-testid="answer-latency">{model.latencyMs} ms</span>
              </li>
            ))}
          </ul>
        </li>
        <li data-testid="step-agreement">
          <strong>Vertailu.</strong>{' '}
          {result.agreement.agreed
            ? `Mallit olivat samaa mieltä: ${result.agreement.label}.`
            : 'Mallit olivat eri mieltä, joten molemmat vastaukset näytetään.'}
        </li>
      </ol>
    </details>
  )
}

Home.layout = [DefaultLayout]
