import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, ApiError, UNAUTHORIZED_EVENT } from '../lib/api'
import type { Language, PermissionUser, PublicConfig, Theme } from '../lib/types'
import { translations, type TranslationKey } from '../i18n/translations'

interface AppContextValue {
  user: PermissionUser | null
  config: PublicConfig | null
  ready: boolean
  language: Language
  theme: Theme
  dir: 'ltr' | 'rtl'
  isRtl: boolean
  currency: string
  demoMode: boolean
  isAdmin: boolean
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  setLanguage: (language: Language) => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  toggleLanguage: () => void
  can: (permission: string) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  refreshConfig: () => Promise<void>
  localName: (row: Record<string, unknown> | null | undefined, base: string) => string
}

const AppContext = createContext<AppContextValue | null>(null)

const LANG_KEY = 'alsheikh.language'
const THEME_KEY = 'alsheikh.theme'

function storedLanguage(): Language {
  const value = localStorage.getItem(LANG_KEY)
  if (value === 'ar' || value === 'en') return value
  return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

function storedTheme(): Theme {
  const value = localStorage.getItem(THEME_KEY)
  if (value === 'light' || value === 'dark') return value
  return 'dark'
}

function applyDocument(language: Language, theme: Theme) {
  const root = document.documentElement
  root.lang = language
  root.dir = language === 'ar' ? 'rtl' : 'ltr'
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#080808' : '#FAF9FC')
}

export function AppProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<PermissionUser | null>(null)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [ready, setReady] = useState(false)
  const [language, setLanguageState] = useState<Language>(storedLanguage)
  const [theme, setThemeState] = useState<Theme>(storedTheme)

  useEffect(() => {
    applyDocument(language, theme)
    localStorage.setItem(LANG_KEY, language)
    localStorage.setItem(THEME_KEY, theme)
  }, [language, theme])

  const refreshUser = useCallback(async () => {
    try {
      const result = await api.get<{ user: PermissionUser }>('/api/auth/me')
      setUser(result.user)
      if (result.user.language) setLanguageState(result.user.language)
      if (result.user.theme) setThemeState(result.user.theme)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null)
    }
  }, [])

  const refreshConfig = useCallback(async () => {
    try {
      const result = await api.get<PublicConfig>('/api/auth/public/config')
      setConfig(result)
    } catch {
      // A public config failure should not block the application shell.
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      await Promise.all([refreshUser(), refreshConfig()])
      if (active) setReady(true)
    })()
    return () => {
      active = false
    }
  }, [refreshUser, refreshConfig])

  // An expired or revoked session must return the user to the login screen and
  // drop every cached financial record, instead of leaving the shell open with
  // a wall of "unauthorized" errors.
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null)
      queryClient.clear()
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized)
  }, [queryClient])

  const persistPreferences = useCallback(
    async (nextLanguage: Language, nextTheme: Theme) => {
      if (!user) return
      try {
        const result = await api.patch<{ user: PermissionUser }>('/api/auth/preferences', {
          language: nextLanguage,
          theme: nextTheme,
        })
        setUser(result.user)
      } catch {
        // Local preferences still apply if the server call fails.
      }
    },
    [user],
  )

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next)
      if (user) void persistPreferences(next, theme)
    },
    [persistPreferences, theme, user],
  )

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next)
      if (user) void persistPreferences(language, next)
    },
    [language, persistPreferences, user],
  )

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme])
  const toggleLanguage = useCallback(() => setLanguage(language === 'en' ? 'ar' : 'en'), [language, setLanguage])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ user: PermissionUser }>('/api/auth/login', { email, password })
    setUser(result.user)
    if (result.user.language) setLanguageState(result.user.language)
    if (result.user.theme) setThemeState(result.user.theme)
    queryClient.clear()
  }, [queryClient])

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout')
    } finally {
      setUser(null)
      queryClient.clear()
    }
  }, [queryClient])

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => {
      const template = translations[language][key] ?? translations.en[key] ?? key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
    },
    [language],
  )

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions?.includes(permission)),
    [user],
  )

  const localName = useCallback(
    (row: Record<string, unknown> | null | undefined, base: string) => {
      if (!row) return '—'
      const ar = row[`${base}_ar`]
      const en = row[`${base}_en`]
      return String(language === 'ar' ? ar || en || '—' : en || ar || '—')
    },
    [language],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      user,
      config,
      ready,
      language,
      theme,
      dir: language === 'ar' ? 'rtl' : 'ltr',
      isRtl: language === 'ar',
      currency: config?.currency || 'EGP',
      demoMode: Boolean(config?.demoMode),
      isAdmin: user?.role_key === 'admin',
      t,
      setLanguage,
      setTheme,
      toggleTheme,
      toggleLanguage,
      can,
      login,
      logout,
      refreshUser,
      refreshConfig,
      localName,
    }),
    [
      user,
      config,
      ready,
      language,
      theme,
      t,
      setLanguage,
      setTheme,
      toggleTheme,
      toggleLanguage,
      can,
      login,
      logout,
      refreshUser,
      refreshConfig,
      localName,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
