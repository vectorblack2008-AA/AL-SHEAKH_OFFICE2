import { Link } from 'react-router-dom'
import { ArrowLeft, Compass, ShieldAlert } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, LogoMark, Panel } from '../components/ui'

export function AccessDeniedPage() {
  const { t } = useApp()
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Panel className="w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-warning/25 bg-warning-soft text-warning">
          <ShieldAlert size={21} />
        </div>
        <p className="eyebrow text-[0.6rem]">{t('access.denied')}</p>
        <h1 className="display mt-2 text-xl text-text">{t('access.denied')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[0.78rem] leading-relaxed text-muted">{t('access.deniedHint')}</p>
        <Link to="/" className="mt-5 inline-block">
          <Button variant="primary" size="sm" icon={<ArrowLeft size={14} />}>
            {t('access.goDashboard')}
          </Button>
        </Link>
      </Panel>
    </div>
  )
}

export function NotFoundPage() {
  const { t } = useApp()
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="text-center">
        <LogoMark size={52} className="mx-auto mb-5 opacity-80" />
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface-2 text-muted">
          <Compass size={19} />
        </div>
        <p className="eyebrow text-[0.6rem]">404</p>
        <h1 className="display mt-2 text-2xl text-text">{t('error.notFound')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-[0.78rem] leading-relaxed text-muted">{t('error.notFoundHint')}</p>
        <Link to="/" className="mt-5 inline-block">
          <Button variant="primary" size="sm" icon={<ArrowLeft size={14} />}>
            {t('access.goDashboard')}
          </Button>
        </Link>
      </div>
    </div>
  )
}
