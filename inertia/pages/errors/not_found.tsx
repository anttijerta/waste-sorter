import DefaultLayout from '~/layouts/default'

export default function NotFound() {
  return (
    <article className="card">
      <span className="tag">404</span>
      <h1 className="card__title">Sivua ei löytynyt</h1>
      <p className="muted">
        Tarkista osoite tai <a href="/">palaa etusivulle</a>.
      </p>
    </article>
  )
}

NotFound.layout = [DefaultLayout]
