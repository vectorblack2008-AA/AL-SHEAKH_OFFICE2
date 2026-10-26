import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Eye, EyeOff, Globe2, Lock, Mail, Moon, ShieldCheck, Sparkles, Sun } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { errorMessage } from '../lib/api'
import { cn } from '../lib/utils'
import { LogoMark, Spinner } from '../components/ui'

export function LoginPage() {
  const { user, ready, login, t, language, theme, toggleTheme, toggleLanguage, config, isRtl } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (ready && user) {
    const target = (location.state as { from?: string } | null)?.from || '/'
    return <Navigate to={target} replace />
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
      const target = (location.state as { from?: string } | null)?.from || '/'
      navigate(target, { replace: true })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  const fill = (account: 'admin' | 'viewer') => {
    setEmail(account === 'admin' ? 'admin@alsheikh.eg' : 'viewer@alsheikh.eg')
    setPassword(account === 'admin' ? 'Admin@12345' : 'Viewer@12345')
    setError('')
  }

  return (
    <div className="auth-canvas relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-30" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col lg:flex-row">
        {/* Editorial panel */}
        <section className="relative hidden flex-1 flex-col justify-between overflow-hidden px-10 py-12 lg:flex xl:px-16">
          <div className="pointer-events-none absolute -start-32 top-1/4 h-[34rem] w-[34rem] rounded-full border border-accent/10" />
          <div className="pointer-events-none absolute -start-16 top-[30%] h-[22rem] w-[22rem] rounded-full border border-accent/10" />
          <div className="pointer-events-none absolute bottom-[-14rem] start-[15%] h-[36rem] w-[22rem] rounded-t-full border border-accent/15 bg-gradient-to-b from-accent/[0.04] to-transparent" />

          <div className="flex items-center gap-3">
            <LogoMark size={46} />
            <div>
              <p className="text-[0.9rem] font-semibold tracking-[0.14em] text-text">AL-SHEIKH</p>
              <p className="eyebrow mt-0.5 text-[0.54rem] tracking-[0.26em]">{t('brand.eyebrow')}</p>
            </div>
          </div>

          <div className="relative max-w-xl py-12">
            <p className="eyebrow mb-5 flex items-center gap-2 text-accent">
              <span className="h-px w-8 bg-accent/60" />
              {t('app.tagline')}
            </p>
            <h1 className="display text-[3.2rem] leading-[1.02] text-text xl:text-[4rem]">
              {language === 'ar' ? (
                <>
                  كل رحلة،
                  <br />
                  <span className="text-gradient">محسوبة بدقة.</span>
                </>
              ) : (
                <>
                  Every journey,
                  <br />
                  <span className="text-gradient">accounted for.</span>
                </>
              )}
            </h1>
            <p className="mt-6 max-w-md text-[0.9rem] leading-relaxed text-muted">{t('brand.description')}</p>

            <div className="mt-9 grid max-w-md gap-3">
              {[t('brand.point1'), t('brand.point2'), t('brand.point3')].map((point) => (
                <div key={point} className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className="text-[0.78rem] text-text-soft">{point}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-border pt-6">
            <div>
              <p className="text-[0.7rem] font-semibold text-text">{t('auth.secure')}</p>
              <p className="mt-0.5 max-w-xs text-[0.62rem] leading-relaxed text-muted">{t('auth.secureHint')}</p>
            </div>
            <div className="ms-auto flex items-center gap-2 text-muted">
              <ShieldCheck size={16} className="text-accent/70" />
              <span className="text-[0.6rem] uppercase tracking-[0.16em]">RBAC · TLS · AUDIT</span>
            </div>
          </div>
        </section>

        {/* Sign-in panel */}
        <section className="flex flex-1 flex-col px-4 py-5 sm:px-8 lg:max-w-[600px] lg:border-s lg:border-border lg:px-12 xl:px-16">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 lg:hidden">
              <LogoMark size={34} />
              <div>
                <p className="text-[0.78rem] font-semibold tracking-[0.12em] text-text">AL-SHEIKH</p>
                <p className="text-[0.58rem] text-muted">{t('app.officeArabic')}</p>
              </div>
            </div>
            <div className="ms-auto flex items-center gap-1">
              <button
                type="button"
                onClick={toggleLanguage}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.65rem] font-semibold text-muted transition hover:bg-surface-2 hover:text-text"
              >
                <Globe2 size={13} />
                {language === 'en' ? 'العربية' : 'EN'}
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-text"
                aria-label={theme === 'dark' ? t('common.light') : t('common.dark')}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center py-8">
            <div className="w-full max-w-[24rem] animate-fade-up">
              <p className="eyebrow mb-3">{t('auth.account')}</p>
              <h2 className="display text-[2rem] text-text">{t('auth.welcome')}</h2>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-muted">{t('auth.subtitle')}</p>

              {config?.demoMode ? (
                <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-accent/20 bg-accent-soft px-3 py-2.5">
                  <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
                  <p className="text-[0.68rem] leading-relaxed text-text-soft">{t('auth.demoHint')}</p>
                </div>
              ) : null}

              <form onSubmit={submit} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="email" className="label">
                    {t('auth.email')}
                  </label>
                  <div className="relative">
                    <Mail size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="field h-11 ps-9"
                      placeholder="name@alsheikh.eg"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="label">
                    {t('auth.password')}
                  </label>
                  <div className="relative">
                    <Lock size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="field h-11 px-9"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="absolute end-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted transition hover:text-text"
                      aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div role="alert" aria-live="assertive" className="rounded-xl border border-negative/25 bg-negative-soft px-3 py-2.5 text-[0.7rem] leading-relaxed text-negative">
                    {error}
                  </div>
                ) : null}

                <button type="submit" disabled={loading} aria-busy={loading} className="btn btn-primary h-11 w-full">
                  {loading ? <Spinner size={16} className="text-current" /> : null}
                  {loading ? t('auth.signingIn') : t('auth.signIn')}
                  {!loading ? <ArrowRight size={15} className={isRtl ? 'rotate-180' : ''} /> : null}
                </button>
              </form>

              {config?.showDemoCredentials && config.demoMode ? (
                <div className="mt-8 border-t border-border pt-5">
                  <div className="flex items-center justify-between">
                    <p className="eyebrow text-[0.56rem]">{t('auth.demoCredentials')}</p>
                    <span className="flex items-center gap-1 text-[0.58rem] text-accent">
                      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                      {t('demo.modeOn')}
                    </span>
                  </div>
                  <div className="mt-2.5 grid gap-2">
                    {[
                      { key: 'admin' as const, label: t('auth.admin'), email: 'admin@alsheikh.eg', password: 'Admin@12345' },
                      { key: 'viewer' as const, label: t('auth.viewer'), email: 'viewer@alsheikh.eg', password: 'Viewer@12345' },
                    ].map((account) => (
                      <button
                        key={account.key}
                        type="button"
                        onClick={() => fill(account.key)}
                        className={cn(
                          'group flex items-center gap-3 rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-start transition hover:border-border-strong hover:bg-surface-2',
                          email === account.email && 'border-accent/40 bg-accent-softer',
                        )}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-[0.62rem] font-bold text-accent">
                          {account.key === 'admin' ? 'AD' : 'VW'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.7rem] font-semibold text-text">{account.label}</span>
                          <span className="block truncate text-[0.6rem] text-muted">
                            {account.email} · {account.password}
                          </span>
                        </span>
                        <span className="text-[0.6rem] font-semibold text-accent opacity-0 transition group-hover:opacity-100">
                          {t('auth.useAccount')}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <p className="text-center text-[0.6rem] text-muted/70">
            {t('app.footer')} · {new Date().getFullYear()}
          </p>
        </section>
      </div>
    </div>
  )
}
