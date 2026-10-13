import DefaultLayout from '~/layouts/default'

export default function ServerError() {
  return (
    <article className="card">
      <span className="tag">500</span>
      <h1 className="card__title">Jokin meni pieleen</h1>
      <p className="muted">Yritä hetken päästä uudelleen.</p>
    </article>
  )
}

ServerError.layout = [DefaultLayout]
