import { type ReactNode } from 'react'

export default function DefaultLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="header">
        <div className="header__inner">
          <span className="header__title">Jätelajittelija</span>
          <span className="tag">HSY-lajitteluohje</span>
        </div>
      </header>
      <main className="main">{children}</main>
    </>
  )
}
