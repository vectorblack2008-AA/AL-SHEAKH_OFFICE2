import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bus,
  CreditCard,
  Database,
  FileText,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Route as RouteIcon,
  ScrollText,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wallet,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { BusinessSettings, ExpenseCategory, SystemInfo } from '../lib/types'
import { formatDate, formatDateTime, num } from '../lib/utils'
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  InfoRow,
  Input,
  Modal,
  PageHeader,
  Panel,
  SectionHeader,
  Select,
  Switch,
  Tabs,
  TabPanel,
} from '../components/ui'
import { PageError, PageSkeleton } from '../components/filters'

type SettingsTab = 'general' | 'categories' | 'demo' | 'system'

const TABS: SettingsTab[] = ['general', 'categories', 'demo', 'system']

interface GeneralForm {
  company_name_en: string
  company_name_ar: string
  logo_url: string
  currency: string
  vat_rate: string
  trip_buffer_minutes: string
  operating_hours_per_day: string
  timezone: string
  invoice_terms_days: string
}

interface CategoryForm {
  key: string
  name_en: string
  name_ar: string
  is_operating: boolean
  is_active: boolean
}

function formFromSettings(settings: BusinessSettings): GeneralForm {
  return {
    company_name_en: settings.company_name_en ?? '',
    company_name_ar: settings.company_name_ar ?? '',
    logo_url: settings.logo_url ?? '',
    currency: settings.currency ?? 'EGP',
    vat_rate: String(settings.vat_rate ?? 14),
    trip_buffer_minutes: String(settings.trip_buffer_minutes ?? 30),
    operating_hours_per_day: String(settings.operating_hours_per_day ?? 12),
    timezone: settings.timezone ?? 'Africa/Cairo',
    invoice_terms_days: String(settings.invoice_terms_days ?? 30),
  }
}

const EMPTY_SETTINGS: GeneralForm = {
  company_name_en: '',
  company_name_ar: '',
  logo_url: '',
  currency: 'EGP',
  vat_rate: '14',
  trip_buffer_minutes: '30',
  operating_hours_per_day: '12',
  timezone: 'Africa/Cairo',
  invoice_terms_days: '30',
}

function emptyCategory(): CategoryForm {
  return { key: '', name_en: '', name_ar: '', is_operating: true, is_active: true }
}

const COUNT_ITEMS: Array<{ key: keyof SystemInfo['counts']; label: TranslationKey; icon: typeof Bus }> = [
  { key: 'vehicles', label: 'settings.vehicles', icon: Bus },
  { key: 'drivers', label: 'settings.drivers', icon: UserRound },
  { key: 'trips', label: 'settings.trips', icon: RouteIcon },
  { key: 'contracts', label: 'settings.contracts', icon: FileText },
  { key: 'invoices', label: 'settings.invoices', icon: Receipt },
  { key: 'payments', label: 'settings.payments', icon: CreditCard },
  { key: 'expenses', label: 'settings.expenses', icon: Wallet },
]

export function SettingsPage() {
  const { t, language, can, isAdmin, refreshConfig } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabParam = searchParams.get('tab') as SettingsTab | null
  const tab: SettingsTab = tabParam && TABS.includes(tabParam) ? tabParam : 'general'
  const canManage = can('manage_settings')

  const [form, setForm] = useState<GeneralForm>(EMPTY_SETTINGS)
  const initialized = useRef(false)

  const [categoryOpen, setCategoryOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(emptyCategory)
  const [demoConfirm, setDemoConfirm] = useState<'seed' | 'reset' | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPhrase, setResetPhrase] = useState('')

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<BusinessSettings>('/api/settings'),
  })

  const categoriesQuery = useQuery({
    queryKey: ['expenses', 'categories'],
    queryFn: () => api.get<{ data: ExpenseCategory[] }>('/api/expense-categories'),
    enabled: can('view_expenses'),
  })

  const systemInfoQuery = useQuery({
    queryKey: ['system-info'],
    queryFn: () => api.get<SystemInfo>('/api/system-info'),
  })

  const settings = settingsQuery.data
  const categories = categoriesQuery.data?.data ?? []
  const systemInfo = systemInfoQuery.data

  useEffect(() => {
    if (settings && !initialized.current) {
      setForm(formFromSettings(settings))
      initialized.current = true
    }
  }, [settings])

  function setTab(next: SettingsTab) {
    if (next === 'general') setSearchParams({}, { replace: true })
    else setSearchParams({ tab: next }, { replace: true })
  }

  const saveSettingsMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch<BusinessSettings>('/api/settings', payload),
    onSuccess: (updated) => {
      toast.success(t('settings.settingsSaved'))
      setForm(formFromSettings(updated))
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
      void refreshConfig()
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const categoryMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingCategory
        ? api.patch(`/api/expense-categories/${editingCategory.id}`, payload)
        : api.post('/api/expense-categories', payload),
    onSuccess: () => {
      toast.success(t('settings.categorySaved'))
      setCategoryOpen(false)
      setEditingCategory(null)
      setCategoryForm(emptyCategory())
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const categoryStatusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      api.patch(`/api/expense-categories/${id}`, { is_active }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const demoMutation = useMutation({
    mutationFn: (mode: 'seed' | 'reset') => api.post(`/api/demo/${mode}`),
    onSuccess: (_result, mode) => {
      toast.success(mode === 'seed' ? t('demo.seedSuccess') : t('demo.resetSuccess'))
      setDemoConfirm(null)
      void queryClient.invalidateQueries()
      void refreshConfig()
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const workspaceResetMutation = useMutation({
    mutationFn: () => api.post('/api/workspace/reset', { confirmation: resetPhrase.trim().toUpperCase() }),
    onSuccess: () => {
      toast.success(t('settings.resetWorkspaceSuccess'))
      setResetOpen(false)
      setResetPhrase('')
      void queryClient.invalidateQueries()
      void refreshConfig()
    },
    onError: (error) => toast.error(t('error.generic'), errorMessage(error)),
  })

  const resetConfirmed = resetPhrase.trim().toUpperCase() === 'RESET'

  function closeWorkspaceReset() {
    if (workspaceResetMutation.isPending) return
    setResetOpen(false)
    setResetPhrase('')
  }

  function saveGeneral() {
    if (form.company_name_en.trim().length < 2 || form.company_name_ar.trim().length < 2) {
      toast.error(t('error.validation'), t('settings.companyNameEn'))
      return
    }
    if (form.currency.trim().length !== 3) {
      toast.error(t('error.validation'), t('settings.currency'))
      return
    }
    if (num(form.vat_rate) < 0 || num(form.vat_rate) > 100) {
      toast.error(t('error.validation'), t('settings.vatRate'))
      return
    }
    if (num(form.trip_buffer_minutes) < 0 || num(form.trip_buffer_minutes) > 240) {
      toast.error(t('error.validation'), t('settings.tripBuffer'))
      return
    }
    if (num(form.operating_hours_per_day) < 1 || num(form.operating_hours_per_day) > 24) {
      toast.error(t('error.validation'), t('settings.operatingHours'))
      return
    }
    if (num(form.invoice_terms_days) < 0 || num(form.invoice_terms_days) > 365) {
      toast.error(t('error.validation'), t('settings.invoiceTerms'))
      return
    }
    saveSettingsMutation.mutate({
      company_name_en: form.company_name_en.trim(),
      company_name_ar: form.company_name_ar.trim(),
      logo_url: form.logo_url.trim() || null,
      currency: form.currency.trim().toUpperCase(),
      vat_rate: num(form.vat_rate),
      trip_buffer_minutes: Math.round(num(form.trip_buffer_minutes)),
      operating_hours_per_day: num(form.operating_hours_per_day),
      timezone: form.timezone.trim() || 'Africa/Cairo',
      invoice_terms_days: Math.round(num(form.invoice_terms_days)),
    })
  }

  function openCreateCategory() {
    setEditingCategory(null)
    setCategoryForm(emptyCategory())
    setCategoryOpen(true)
  }

  function openEditCategory(category: ExpenseCategory) {
    setEditingCategory(category)
    setCategoryForm({
      key: category.key,
      name_en: category.name_en,
      name_ar: category.name_ar,
      is_operating: category.is_operating,
      is_active: category.is_active,
    })
    setCategoryOpen(true)
  }

  function submitCategory() {
    if (!/^[a-z0-9_]+$/.test(categoryForm.key) || categoryForm.name_en.trim().length < 2 || categoryForm.name_ar.trim().length < 2) {
      toast.error(t('error.validation'), t('settings.categoryHint'))
      return
    }
    const payload: Record<string, unknown> = {
      name_en: categoryForm.name_en.trim(),
      name_ar: categoryForm.name_ar.trim(),
      is_operating: categoryForm.is_operating,
    }
    if (editingCategory) {
      payload.is_active = categoryForm.is_active
    } else {
      payload.key = categoryForm.key.trim()
    }
    categoryMutation.mutate(payload)
  }

  if (settingsQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={`${t('nav.administration')} · ${t('nav.settings')}`} title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <PageSkeleton rows={5} />
      </div>
    )
  }

  if (settingsQuery.error || !settings) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={`${t('nav.administration')} · ${t('nav.settings')}`} title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <PageError error={settingsQuery.error} onRetry={() => void settingsQuery.refetch()} />
      </div>
    )
  }

  const demoOn = Boolean(settings.demo_mode)
  const realRecords = num(systemInfo?.counts.vehicles) > 0
  const seedBlocked = demoOn || realRecords || !canManage

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.administration')} · ${t('nav.settings')}`}
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={
          <IconButton
            label={t('common.refresh')}
            variant="secondary"
            onClick={() => {
              void settingsQuery.refetch()
              void systemInfoQuery.refetch()
            }}
          >
            <RefreshCw size={15} className={settingsQuery.isFetching ? 'animate-spin' : ''} />
          </IconButton>
        }
      />

      <Tabs<SettingsTab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'general', label: t('settings.general') },
          { value: 'categories', label: t('settings.expenseCategories'), count: categories.length },
          { value: 'demo', label: t('settings.demoData') },
          { value: 'system', label: t('settings.system') },
        ]}
      />

      {tab === 'general' ? (
        <TabPanel>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <Panel className="p-4 sm:p-5">
                <SectionHeader title={t('settings.companyProfile')} hint={t('settings.generalHint')} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label={t('settings.companyNameEn')} required>
                    <Input disabled={!canManage} value={form.company_name_en} onChange={(event) => setForm({ ...form, company_name_en: event.target.value })} />
                  </Field>
                  <Field label={t('settings.companyNameAr')} required>
                    <Input disabled={!canManage} dir="rtl" value={form.company_name_ar} onChange={(event) => setForm({ ...form, company_name_ar: event.target.value })} />
                  </Field>
                  <Field label={t('settings.logoUrl')} hint={t('settings.logoHint')} className="sm:col-span-2">
                    <Input
                      disabled={!canManage}
                      value={form.logo_url}
                      onChange={(event) => setForm({ ...form, logo_url: event.target.value })}
                      placeholder="https://…"
                    />
                  </Field>
                  <Field label={t('settings.currency')} required>
                    <Input
                      disabled={!canManage}
                      maxLength={3}
                      value={form.currency}
                      onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label={t('settings.vatRate')}>
                    <Input
                      disabled={!canManage}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={form.vat_rate}
                      onChange={(event) => setForm({ ...form, vat_rate: event.target.value })}
                    />
                  </Field>
                </div>
              </Panel>

              <Panel className="p-4 sm:p-5">
                <SectionHeader title={t('settings.workspaceDefaults')} hint={t('settings.generalHint')} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label={t('settings.tripBuffer')}>
                    <Input
                      disabled={!canManage}
                      type="number"
                      min={0}
                      max={240}
                      step="1"
                      value={form.trip_buffer_minutes}
                      onChange={(event) => setForm({ ...form, trip_buffer_minutes: event.target.value })}
                    />
                  </Field>
                  <Field label={t('settings.operatingHours')}>
                    <Input
                      disabled={!canManage}
                      type="number"
                      min={1}
                      max={24}
                      step="0.5"
                      value={form.operating_hours_per_day}
                      onChange={(event) => setForm({ ...form, operating_hours_per_day: event.target.value })}
                    />
                  </Field>
                  <Field label={t('settings.invoiceTerms')}>
                    <Input
                      disabled={!canManage}
                      type="number"
                      min={0}
                      max={365}
                      step="1"
                      value={form.invoice_terms_days}
                      onChange={(event) => setForm({ ...form, invoice_terms_days: event.target.value })}
                    />
                  </Field>
                  <Field label={t('settings.timezone')}>
                    <Input
                      disabled={!canManage}
                      value={form.timezone}
                      onChange={(event) => setForm({ ...form, timezone: event.target.value })}
                      placeholder="Africa/Cairo"
                    />
                  </Field>
                </div>
              </Panel>

              {canManage ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setForm(formFromSettings(settings))}
                    disabled={saveSettingsMutation.isPending}
                  >
                    {t('common.reset')}
                  </Button>
                  <Button variant="primary" loading={saveSettingsMutation.isPending} onClick={saveGeneral}>
                    {t('settings.saveSettings')}
                  </Button>
                </div>
              ) : (
                <p className="rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-[0.7rem] text-muted">{t('users.readOnlyRole')}</p>
              )}
            </div>

            <div className="space-y-4">
              <Panel className="relative overflow-hidden p-5">
                <div className="pointer-events-none absolute -end-8 -top-10 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
                <p className="eyebrow text-[0.58rem]">{t('app.office')}</p>
                <h3 className="mt-2 text-lg font-semibold tracking-tight text-text">{language === 'ar' ? form.company_name_ar : form.company_name_en}</h3>
                <p className="mt-0.5 text-[0.7rem] text-muted">{language === 'ar' ? form.company_name_en : form.company_name_ar}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Badge tone="accent">{form.currency || 'EGP'}</Badge>
                  <Badge tone="neutral">VAT {num(form.vat_rate)}%</Badge>
                  <Badge tone={demoOn ? 'warning' : 'positive'} dot>
                    {demoOn ? t('settings.on') : t('settings.off')} · {t('settings.demoMode')}
                  </Badge>
                </div>
                <div className="mt-4 border-t border-border pt-3">
                  <InfoRow label={t('settings.tripBuffer')} value={`${num(form.trip_buffer_minutes)} ${t('common.minutes')}`} />
                  <InfoRow label={t('settings.operatingHours')} value={`${num(form.operating_hours_per_day)} ${t('common.hours')}`} />
                  <InfoRow label={t('settings.invoiceTerms')} value={`${num(form.invoice_terms_days)} ${t('common.days')}`} />
                  <InfoRow label={t('settings.timezone')} value={form.timezone || '—'} />
                  <InfoRow label={t('settings.lastUpdated')} value={formatDateTime(settings.updated_at, language)} />
                </div>
              </Panel>

              <Panel className="p-4">
                <div className="flex items-start gap-2.5">
                  <Sparkles size={15} className="mt-0.5 shrink-0 text-accent" />
                  <div>
                    <p className="text-[0.72rem] font-semibold text-text">{t('settings.demoHint')}</p>
                    <Link to="/settings?tab=demo" className="mt-1 inline-block text-[0.66rem] font-semibold text-accent underline-offset-4 hover:underline">
                      {t('demo.manage')}
                    </Link>
                  </div>
                </div>
              </Panel>
            </div>
          </div>
        </TabPanel>
      ) : null}

      {tab === 'categories' ? (
        <TabPanel className="space-y-4">
          <Panel className="p-4">
            <SectionHeader
              title={t('settings.expenseCategories')}
              hint={t('settings.categoryHint')}
              action={
                canManage ? (
                  <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreateCategory}>
                    {t('settings.addCategory')}
                  </Button>
                ) : undefined
              }
            />
          </Panel>

          {!can('view_expenses') ? (
            <Panel>
              <EmptyState icon={<Wallet size={20} />} title={t('access.denied')} hint={t('access.deniedHint')} />
            </Panel>
          ) : categoriesQuery.isLoading ? (
            <PageSkeleton rows={5} />
          ) : categoriesQuery.error ? (
            <PageError error={categoriesQuery.error} onRetry={() => void categoriesQuery.refetch()} />
          ) : categories.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Wallet size={20} />}
                title={t('common.noData')}
                action={
                  canManage ? (
                    <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreateCategory}>
                      {t('settings.addCategory')}
                    </Button>
                  ) : undefined
                }
              />
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <div className="scroll-x">
                <table className="data-table min-w-[760px]">
                  <thead>
                    <tr>
                      <th>{t('common.name')}</th>
                      <th>{t('settings.categoryKey')}</th>
                      <th>{t('common.type')}</th>
                      <th>{t('settings.categoryActive')}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((category) => (
                      <tr key={category.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="text-[0.74rem] font-semibold text-text">
                              {language === 'ar' ? category.name_ar : category.name_en}
                            </span>
                            {category.is_system ? <Badge tone="neutral">{t('settings.systemCategory')}</Badge> : null}
                          </div>
                          <p className="mt-0.5 text-[0.62rem] text-muted">{language === 'ar' ? category.name_en : category.name_ar}</p>
                        </td>
                        <td className="font-mono text-[0.66rem] text-muted">{category.key}</td>
                        <td>
                          <Badge tone={category.is_operating ? 'accent' : 'info'}>
                            {category.is_operating ? t('expenses.operating') : t('expenses.capital')}
                          </Badge>
                        </td>
                        <td>
                          <Switch
                            checked={category.is_active}
                            disabled={!canManage || categoryStatusMutation.isPending}
                            onChange={(checked) => categoryStatusMutation.mutate({ id: category.id, is_active: checked })}
                            label={category.is_active ? t('settings.on') : t('settings.off')}
                          />
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1">
                            {canManage ? (
                              <IconButton label={t('common.edit')} size="sm" onClick={() => openEditCategory(category)}>
                                <Pencil size={13} />
                              </IconButton>
                            ) : (
                              <span className="text-[0.64rem] text-muted">{t('users.readOnlyRole')}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </TabPanel>
      ) : null}

      {tab === 'demo' ? (
        <TabPanel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel className="relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -end-6 -top-8 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow text-[0.58rem]">{t('demo.banner')}</p>
                  <h3 className="mt-1.5 text-base font-semibold text-text">{demoOn ? t('demo.modeOn') : t('demo.modeOff')}</h3>
                </div>
                <Badge tone={demoOn ? 'warning' : 'positive'} dot>
                  {demoOn ? t('settings.on') : t('settings.off')}
                </Badge>
              </div>
              <p className="mt-3 text-[0.74rem] leading-relaxed text-text-soft">{t('settings.demoHint')}</p>
              <div className="mt-4 rounded-xl border border-border bg-surface-2/50 p-3">
                <p className="text-[0.68rem] leading-relaxed text-muted">{demoOn ? t('demo.resetHint') : t('demo.seedHint')}</p>
              </div>
              {!demoOn && realRecords ? (
                <p className="mt-3 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[0.68rem] leading-relaxed text-warning">
                  {t('demo.realDataWarning')}
                </p>
              ) : null}
              {demoOn ? (
                <p className="mt-3 rounded-xl border border-negative/25 bg-negative-soft px-3 py-2 text-[0.68rem] leading-relaxed text-negative">
                  {t('demo.resetWarning')}
                </p>
              ) : null}
            </Panel>

            <Panel className="p-5">
              <SectionHeader title={t('demo.manage')} hint={t('settings.demoData')} />
              <div className="mt-4 space-y-2.5">
                <Button
                  variant="primary"
                  icon={<Sparkles size={14} />}
                  disabled={seedBlocked}
                  onClick={() => setDemoConfirm('seed')}
                  className="w-full justify-center"
                >
                  {t('demo.seed')}
                </Button>
                <Button
                  variant="danger"
                  icon={<RefreshCw size={14} />}
                  disabled={!demoOn || !canManage}
                  onClick={() => setDemoConfirm('reset')}
                  className="w-full justify-center"
                >
                  {t('demo.reset')}
                </Button>
                {!canManage ? <p className="text-center text-[0.66rem] text-muted">{t('users.readOnlyRole')}</p> : null}
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <InfoRow label={t('settings.demoMode')} value={demoOn ? t('settings.on') : t('settings.off')} />
                <InfoRow label={t('settings.vehicles')} value={systemInfoQuery.isLoading ? '…' : num(systemInfo?.counts.vehicles)} />
                <InfoRow label={t('settings.contracts')} value={systemInfoQuery.isLoading ? '…' : num(systemInfo?.counts.contracts)} />
                <InfoRow label={t('settings.invoices')} value={systemInfoQuery.isLoading ? '…' : num(systemInfo?.counts.invoices)} />
              </div>
            </Panel>
          </div>

          <Panel className="mt-4 border-negative/30 p-5">
            <SectionHeader title={t('settings.resetWorkspace')} hint={t('settings.resetWorkspaceHint')} />
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-negative/25 bg-negative-soft p-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[0.7rem] leading-relaxed text-negative">{t('settings.resetWorkspaceWarning')}</p>
              <Button
                variant="danger"
                size="sm"
                icon={<TriangleAlert size={14} />}
                disabled={!isAdmin}
                onClick={() => {
                  setResetPhrase('')
                  setResetOpen(true)
                }}
                className="shrink-0 justify-center"
              >
                {t('settings.resetWorkspace')}
              </Button>
            </div>
            {!isAdmin ? <p className="mt-2 text-[0.66rem] text-muted">{t('users.readOnlyRole')}</p> : null}
          </Panel>
        </TabPanel>
      ) : null}

      {tab === 'system' ? (
        <TabPanel className="space-y-4">
          {systemInfoQuery.isLoading ? (
            <PageSkeleton rows={4} />
          ) : systemInfoQuery.error ? (
            <PageError error={systemInfoQuery.error} onRetry={() => void systemInfoQuery.refetch()} />
          ) : (
            <>
              <Panel className="p-4 sm:p-5">
                <SectionHeader
                  title={t('settings.systemInfo')}
                  hint={t('settings.systemInfoHint')}
                  action={
                    <Link
                      to="/audit"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-[0.66rem] font-semibold text-text-soft transition hover:border-border-strong hover:text-text"
                    >
                      <ScrollText size={13} />
                      {t('settings.openAudit')}
                    </Link>
                  }
                />
                <div className="mt-4 grid gap-2.5">
                  <InfoRow label={t('settings.database')} value={<span className="font-mono text-[0.68rem]">{systemInfo?.database}</span>} />
                  <InfoRow label={t('settings.timezone')} value={systemInfo?.timezone} />
                  <InfoRow label={t('common.date')} value={formatDate(systemInfo?.date, language)} />
                  <InfoRow label={t('settings.version')} value={t('settings.versionValue')} />
                  <InfoRow label={t('settings.demoMode')} value={demoOn ? t('settings.on') : t('settings.off')} />
                </div>
              </Panel>

              <Panel className="p-4 sm:p-5">
                <SectionHeader title={t('settings.counts')} />
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
                  {COUNT_ITEMS.map((item) => {
                    const Icon = item.icon
                    return (
                      <div key={item.key} className="rounded-xl border border-border bg-surface-2/40 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-muted">{t(item.label)}</p>
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-accent">
                            <Icon size={13} />
                          </span>
                        </div>
                        <p className="mt-2 text-[1.15rem] font-semibold tabular text-text">{num(systemInfo?.counts[item.key]).toLocaleString()}</p>
                      </div>
                    )
                  })}
                  <div className="rounded-xl border border-accent/25 bg-accent-softer p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[0.6rem] font-bold uppercase tracking-[0.12em] text-accent">{t('settings.demoMode')}</p>
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/25 bg-surface text-accent">
                        <Database size={13} />
                      </span>
                    </div>
                    <p className="mt-2 text-[0.95rem] font-semibold text-text">{demoOn ? t('settings.on') : t('settings.off')}</p>
                  </div>
                </div>
              </Panel>
            </>
          )}
        </TabPanel>
      ) : null}

      <Modal
        open={categoryOpen}
        onClose={() => {
          setCategoryOpen(false)
          setEditingCategory(null)
        }}
        title={editingCategory ? t('settings.categoryEdit') : t('settings.categoryCreate')}
        description={t('settings.categoryHint')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCategoryOpen(false)
                setEditingCategory(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={categoryMutation.isPending} onClick={submitCategory}>
              {editingCategory ? t('common.saveChanges') : t('common.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('settings.categoryKey')} required hint={editingCategory ? t('settings.systemCategory') : 'lowercase_with_underscores'}>
            <Input
              value={categoryForm.key}
              disabled={Boolean(editingCategory)}
              onChange={(event) => setCategoryForm({ ...categoryForm, key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
              placeholder="fuel"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('settings.categoryNameEn')} required>
              <Input value={categoryForm.name_en} onChange={(event) => setCategoryForm({ ...categoryForm, name_en: event.target.value })} />
            </Field>
            <Field label={t('settings.categoryNameAr')} required>
              <Input dir="rtl" value={categoryForm.name_ar} onChange={(event) => setCategoryForm({ ...categoryForm, name_ar: event.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-6 rounded-xl border border-border bg-surface-2/50 px-3.5 py-3">
            <Switch
              checked={categoryForm.is_operating}
              onChange={(checked) => setCategoryForm({ ...categoryForm, is_operating: checked })}
              label={t('settings.isOperating')}
            />
            {editingCategory ? (
              <Switch
                checked={categoryForm.is_active}
                onChange={(checked) => setCategoryForm({ ...categoryForm, is_active: checked })}
                label={t('settings.categoryActive')}
              />
            ) : null}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(demoConfirm)}
        onClose={() => setDemoConfirm(null)}
        onConfirm={() => {
          if (demoConfirm) demoMutation.mutate(demoConfirm)
        }}
        title={demoConfirm === 'reset' ? t('demo.reset') : t('demo.seed')}
        description={
          <span className="space-y-2">
            <span className="block">{demoConfirm === 'reset' ? t('settings.demoResetConfirm') : t('settings.demoSeedConfirm')}</span>
            {demoConfirm === 'reset' ? <span className="block text-[0.72rem] text-negative">{t('demo.resetWarning')}</span> : null}
          </span>
        }
        confirmLabel={demoConfirm === 'reset' ? t('demo.reset') : t('demo.seed')}
        tone={demoConfirm === 'reset' ? 'danger' : 'primary'}
        loading={demoMutation.isPending}
      />

      <Modal
        open={resetOpen}
        onClose={closeWorkspaceReset}
        title={t('settings.resetWorkspaceConfirmTitle')}
        description={t('settings.resetWorkspaceHint')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closeWorkspaceReset} disabled={workspaceResetMutation.isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              icon={<TriangleAlert size={14} />}
              onClick={() => workspaceResetMutation.mutate()}
              disabled={!resetConfirmed}
              loading={workspaceResetMutation.isPending}
            >
              {t('settings.resetWorkspace')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[0.74rem] leading-relaxed text-text-soft">{t('settings.resetWorkspaceConfirmText')}</p>
          <p className="rounded-xl border border-negative/25 bg-negative-soft px-3 py-2.5 text-[0.7rem] leading-relaxed text-negative">
            {t('settings.resetWorkspaceWarning')}
          </p>
          <Field label={t('settings.resetWorkspaceTypeLabel')} hint={t('settings.resetWorkspaceTypeHint')} required>
            <Input
              value={resetPhrase}
              onChange={(event) => setResetPhrase(event.target.value)}
              placeholder="RESET"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-[0.12em]"
            />
          </Field>
          {resetPhrase.length > 0 && !resetConfirmed ? (
            <p className="text-[0.68rem] font-medium text-negative">{t('settings.resetWorkspaceMismatch')}</p>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}
