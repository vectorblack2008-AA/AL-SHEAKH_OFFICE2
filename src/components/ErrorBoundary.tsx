import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Home, RotateCcw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, LogoMark } from './ui'

function CrashScreen({ error }: { error: Error }) {
  const { t } = useApp()

  return (
    <div className="app-canvas flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-surface p-6 shadow-xl sm:p-8">
        <LogoMark size={46} />
        <p className="eyebrow mt-5 text-[0.58rem]">{t('error.boundaryEyebrow')}</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-text">{t('error.boundaryTitle')}</h1>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-text-soft">{t('error.boundaryText')}</p>
        <pre className="mt-4 max-h-32 overflow-auto rounded-xl border border-border bg-surface-2/60 p-3 font-mono text-[0.66rem] leading-relaxed text-negative">
          {error.message}
        </pre>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button icon={<RotateCcw size={14} />} onClick={() => window.location.reload()}>
            {t('error.reload')}
          </Button>
          <Button
            variant="secondary"
            icon={<Home size={14} />}
            onClick={() => {
              window.location.assign('/')
            }}
          >
            {t('error.goHome')}
          </Button>
        </div>
        <p className="mt-4 text-[0.68rem] leading-relaxed text-muted">{t('error.boundaryHint')}</p>
      </div>
    </div>
  )
}

type ErrorBoundaryState = { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled interface error', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <CrashScreen error={this.state.error} />
    return this.props.children
  }
}
