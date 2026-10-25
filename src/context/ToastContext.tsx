import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { cn } from '../lib/utils'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  title: string
  message?: string
  tone: ToastTone
}

interface ToastContextValue {
  toast: (title: string, options?: { message?: string; tone?: ToastTone }) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const toast = useCallback(
    (title: string, options?: { message?: string; tone?: ToastTone }) => {
      counter.current += 1
      const id = counter.current
      setItems((current) => [...current.slice(-3), { id, title, message: options?.message, tone: options?.tone ?? 'info' }])
      const timer = setTimeout(() => dismiss(id), 5200)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
    }
  }, [])

  const value: ToastContextValue = {
    toast,
    success: (title, message) => toast(title, { message, tone: 'success' }),
    error: (title, message) => toast(title, { message, tone: 'error' }),
    info: (title, message) => toast(title, { message, tone: 'info' }),
    warning: (title, message) => toast(title, { message, tone: 'warning' }),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6">
        {items.map((item) => {
          const Icon = icons[item.tone]
          return (
            <div
              key={item.id}
              className={cn(
                'toast pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl',
                item.tone === 'success' && 'border-positive/30 bg-surface/95',
                item.tone === 'error' && 'border-negative/30 bg-surface/95',
                item.tone === 'warning' && 'border-warning/30 bg-surface/95',
                item.tone === 'info' && 'border-border bg-surface/95',
              )}
              role="status"
            >
              <Icon
                size={18}
                className={cn(
                  'mt-0.5 shrink-0',
                  item.tone === 'success' && 'text-positive',
                  item.tone === 'error' && 'text-negative',
                  item.tone === 'warning' && 'text-warning',
                  item.tone === 'info' && 'text-accent',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text">{item.title}</p>
                {item.message ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{item.message}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded-lg p-1 text-muted transition hover:bg-surface-2 hover:text-text"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
