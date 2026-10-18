import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import Play from './pages/Play'
import HistoryPage from './pages/History'
import HistoryDetail from './pages/HistoryDetail'
import ImportPage from './pages/Import'
import ShareTarget from './pages/ShareTarget'
import Layout from './components/Layout'

// Dev-only quiz builder: lazy chunk, route registered only in dev builds.
const QuizBuilder = lazy(() => import('./dev/QuizBuilder'))

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/play/:quizId" element={<Play />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:quizId" element={<HistoryDetail />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/share-target" element={<ShareTarget />} />
        {import.meta.env.DEV && (
          <Route
            path="/dev/quiz-builder"
            element={
              <Suspense fallback={<p className="muted">Loading…</p>}>
                <QuizBuilder />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
