import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'

export default function Layout() {
  const navigate = useNavigate()

  useEffect(() => {
    // The share-target service worker posts { type: 'shared-file', key } when a
    // file is shared while an app window is already open.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'shared-file' && typeof event.data.key === 'string') {
        navigate(`/share-target?file=${encodeURIComponent(event.data.key)}`)
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [navigate])

  return (
    <div className="layout">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">?</span> QuizTime
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Quizzes
          </NavLink>
          <NavLink to="/history">History</NavLink>
          <NavLink to="/import" className="nav-import">
            + Import
          </NavLink>
        </nav>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
