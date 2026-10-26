import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  KeyRound,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import type { TranslationKey } from '../i18n/translations'
import { api, errorMessage } from '../lib/api'
import type { Permission, Role, User, UsersResponse } from '../lib/types'
import { formatDateTime } from '../lib/utils'
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  SectionHeader,
  Select,
  Switch,
  Tabs,
  TabPanel,
} from '../components/ui'
import { PageError, PageSkeleton, StatStrip, useDebounced } from '../components/filters'

type UsersTab = 'users' | 'roles'

interface UserForm {
  full_name: string
  email: string
  password: string
  role_id: string
  is_active: boolean
}

const MODULE_LABELS: Record<string, TranslationKey> = {
  Overview: 'nav.dashboard',
  Fleet: 'nav.fleet',
  Drivers: 'nav.drivers',
  Routes: 'nav.routes',
  Trips: 'nav.trips',
  Contracts: 'nav.contracts',
  Finance: 'nav.revenue',
  Expenses: 'nav.expenses',
  Maintenance: 'nav.maintenance',
  Reports: 'nav.reports',
  Administration: 'nav.administration',
  Notifications: 'nav.notifications',
}

function emptyForm(roleId = ''): UserForm {
  return { full_name: '', email: '', password: '', role_id: roleId, is_active: true }
}

export function UsersPage() {
  const { t, language, can, user: currentUser, refreshUser } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<UsersTab>('users')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const debounced = useDebounced(search)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [form, setForm] = useState<UserForm>(() => emptyForm())

  const [passwordTarget, setPasswordTarget] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)

  const [selectedRoleId, setSelectedRoleId] = useState('')
  const [draft, setDraft] = useState<string[]>([])

  const canManage = can('manage_users')

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UsersResponse>('/api/users'),
  })

  const users = usersQuery.data?.data ?? []
  const roles = usersQuery.data?.roles ?? []
  const permissionRows = usersQuery.data?.permissions ?? []

  const rolePermissions = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const row of permissionRows) {
      ;(map[row.role_id] ||= []).push(row.key)
    }
    return map
  }, [permissionRows])

  // The users endpoint returns one row per role-permission assignment. Collapse
  // those rows into a single catalog before rendering the permission matrix.
  const permissionCatalog = useMemo(() => {
    const byKey = new Map<string, Permission>()
    for (const row of permissionRows) {
      if (!byKey.has(row.key)) byKey.set(row.key, row)
    }
    return Array.from(byKey.values())
  }, [permissionRows])

  const permissionsByModule = useMemo(() => {
    const groups = new Map<string, Permission[]>()
    for (const permission of permissionCatalog) {
      if (!groups.has(permission.module)) groups.set(permission.module, [])
      groups.get(permission.module)!.push(permission)
    }
    return Array.from(groups.entries()).map(([module, items]) => ({ module, items }))
  }, [permissionCatalog])

  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? null
  const roleIsProtected = selectedRole?.key === 'admin'
  const savedPermissions = selectedRole ? (rolePermissions[selectedRole.id] ?? []) : []
  const allPermissionKeys = useMemo(() => permissionCatalog.map((row) => row.key), [permissionCatalog])
  const effectiveDraft = roleIsProtected ? allPermissionKeys : draft
  const dirty = useMemo(() => {
    if (!selectedRole || roleIsProtected) return false
    const left = [...effectiveDraft].sort().join('|')
    const right = [...savedPermissions].sort().join('|')
    return left !== right
  }, [effectiveDraft, roleIsProtected, savedPermissions, selectedRole])

  useEffect(() => {
    if (selectedRoleId || !roles.length) return
    const preferred = roles.find((role) => role.key === 'viewer') ?? roles[0]
    setSelectedRoleId(preferred.id)
    setDraft(rolePermissions[preferred.id] ?? [])
  }, [rolePermissions, roles, selectedRoleId])

  function selectRole(role: Role) {
    setSelectedRoleId(role.id)
    setDraft(rolePermissions[role.id] ?? [])
  }

  const filteredUsers = useMemo(() => {
    const term = debounced.trim().toLowerCase()
    return users.filter((row) => {
      if (roleFilter && row.role_id !== roleFilter) return false
      if (!term) return true
      return [row.full_name, row.email, row.role_key, row.role_name_en, row.role_name_ar]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [debounced, roleFilter, users])

  const activeUsers = users.filter((row) => row.is_active).length
  const inactiveUsers = users.length - activeUsers
  const activeAdmins = users.filter((row) => row.role_key === 'admin' && row.is_active).length

  const saveUserMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing ? api.patch<User>(`/api/users/${editing.id}`, payload) : api.post<User>('/api/users', payload),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setFormOpen(false)
      setEditing(null)
      setForm(emptyForm())
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
      if (editing?.id === currentUser?.id) void refreshUser()
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const passwordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api.patch(`/api/users/${id}`, { password }),
    onSuccess: () => {
      toast.success(t('common.saved'), t('users.resetPassword'))
      setPasswordTarget(null)
      setNewPassword('')
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api.patch(`/api/users/${id}`, { is_active }),
    onSuccess: () => {
      toast.success(t('common.saved'))
      setDeactivateTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
      if (deactivateTarget?.id === currentUser?.id) void refreshUser()
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  const permissionMutation = useMutation({
    mutationFn: () => api.patch(`/api/roles/${selectedRole!.id}/permissions`, { permission_keys: draft }),
    onSuccess: () => {
      toast.success(t('users.permissionSaved'))
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      void queryClient.invalidateQueries({ queryKey: ['audit'] })
      if (currentUser?.role_id === selectedRole?.id) void refreshUser()
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  function roleLabel(role: Role) {
    const key = `role.${role.key}` as TranslationKey
    const translated = t(key)
    return translated === key ? (language === 'ar' ? role.name_ar : role.name_en) : translated
  }

  function roleNameForUser(row: User) {
    const key = `role.${row.role_key}` as TranslationKey
    const translated = t(key)
    if (translated !== key) return translated
    return language === 'ar' ? row.role_name_ar || row.role_key : row.role_name_en || row.role_key
  }

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(row: User) {
    setEditing(row)
    setForm({
      full_name: row.full_name,
      email: row.email,
      password: '',
      role_id: row.role_id,
      is_active: row.is_active,
    })
    setFormOpen(true)
  }

  function submitUser() {
    if (form.full_name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || !form.role_id) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    if (!editing && form.password.length < 8) {
      toast.error(t('error.validation'), t('users.passwordMin'))
      return
    }
    if (editing && form.password && form.password.length < 8) {
      toast.error(t('error.validation'), t('users.passwordMin'))
      return
    }
    const payload: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      email: form.email.trim().toLowerCase(),
      role_id: form.role_id,
      is_active: form.is_active,
    }
    if (form.password) payload.password = form.password
    saveUserMutation.mutate(payload)
  }

  function submitPassword() {
    if (!passwordTarget) return
    if (newPassword.length < 8) {
      toast.error(t('error.validation'), t('users.passwordMin'))
      return
    }
    passwordMutation.mutate({ id: passwordTarget.id, password: newPassword })
  }

  function togglePermission(key: string, checked: boolean) {
    setDraft((current) => (checked ? [...current, key] : current.filter((item) => item !== key)))
  }

  function toggleModule(items: Permission[], checked: boolean) {
    const keys = items.map((item) => item.key)
    setDraft((current) => {
      const without = current.filter((key) => !keys.includes(key))
      return checked ? [...without, ...keys] : without
    })
  }

  const headerActions = (
    <>
      <IconButton label={t('common.refresh')} variant="secondary" onClick={() => void usersQuery.refetch()}>
        <RefreshCw size={15} className={usersQuery.isFetching ? 'animate-spin' : ''} />
      </IconButton>
      {canManage ? (
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
          {t('users.addUser')}
        </Button>
      ) : null}
    </>
  )

  if (usersQuery.isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={`${t('nav.administration')} · ${t('nav.users')}`} title={t('users.title')} subtitle={t('users.subtitle')} />
        <PageSkeleton rows={6} />
      </div>
    )
  }

  if (usersQuery.error) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow={`${t('nav.administration')} · ${t('nav.users')}`} title={t('users.title')} subtitle={t('users.subtitle')} />
        <PageError error={usersQuery.error} onRetry={() => void usersQuery.refetch()} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${t('nav.administration')} · ${t('nav.users')}`}
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={headerActions}
      />

      <StatStrip
        items={[
          { label: t('users.users'), value: users.length },
          { label: t('users.activeUsers'), value: activeUsers, tone: 'positive' },
          { label: t('users.inactiveUsers'), value: inactiveUsers, tone: inactiveUsers > 0 ? 'warning' : 'default' },
          { label: t('users.rolesPermissions'), value: roles.length, tone: 'accent' },
        ]}
      />

      <Tabs<UsersTab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'users', label: t('users.users'), count: users.length },
          { value: 'roles', label: t('users.rolesPermissions'), count: roles.length },
        ]}
      />

      {tab === 'users' ? (
        <TabPanel className="space-y-4">
          <Panel className="p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <SearchInput value={search} onChange={setSearch} className="w-full sm:w-64" />
              <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="w-auto min-w-[10rem]">
                <option value="">{t('users.roleFilter')}</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleLabel(role)}
                  </option>
                ))}
              </Select>
              <span className="ms-auto text-[0.68rem] text-muted">
                {filteredUsers.length} / {users.length}
              </span>
            </div>
          </Panel>

          {filteredUsers.length === 0 ? (
            <Panel>
              <EmptyState
                icon={<Users size={20} />}
                title={users.length ? t('common.noResults') : t('users.empty')}
                hint={users.length ? t('common.noResultsHint') : t('users.emptyHint')}
                action={
                  canManage && !users.length ? (
                    <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={openCreate}>
                      {t('users.addUser')}
                    </Button>
                  ) : undefined
                }
              />
            </Panel>
          ) : (
            <Panel className="overflow-hidden">
              <div className="scroll-x">
                <table className="data-table min-w-[900px]">
                  <thead>
                    <tr>
                      <th>{t('users.user')}</th>
                      <th>{t('users.role')}</th>
                      <th>{t('users.accountStatus')}</th>
                      <th>{t('users.lastLogin')}</th>
                      <th>{t('users.createdAt')}</th>
                      <th className="text-end">{t('common.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((row) => {
                      const isSelf = row.id === currentUser?.id
                      const isLastAdmin = row.role_key === 'admin' && activeAdmins <= 1 && row.is_active
                      const selfBlocked = isSelf
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <Avatar name={row.full_name} size="sm" />
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-[0.74rem] font-semibold text-text">{row.full_name}</span>
                                  {isSelf ? <Badge tone="accent">{t('users.you')}</Badge> : null}
                                </div>
                                <p className="truncate text-[0.64rem] text-muted">{row.email}</p>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              {row.role_key === 'admin' ? <ShieldCheck size={13} className="text-accent" /> : <UserCog size={13} className="text-muted" />}
                              <span className="text-[0.7rem] font-medium text-text-soft">{roleNameForUser(row)}</span>
                            </div>
                          </td>
                          <td>
                            <Badge tone={row.is_active ? 'positive' : 'negative'} dot>
                              {row.is_active ? t('users.active') : t('users.inactive')}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap text-[0.68rem] text-muted">
                            {row.last_login_at ? formatDateTime(row.last_login_at, language) : t('users.never')}
                          </td>
                          <td className="whitespace-nowrap text-[0.68rem] text-muted">{formatDateTime(row.created_at, language)}</td>
                          <td>
                            <div className="flex items-center justify-end gap-1">
                              {canManage ? (
                                <>
                                  <IconButton label={t('common.edit')} size="sm" onClick={() => openEdit(row)}>
                                    <Pencil size={13} />
                                  </IconButton>
                                  <IconButton label={t('users.resetPassword')} size="sm" onClick={() => { setPasswordTarget(row); setNewPassword('') }}>
                                    <KeyRound size={13} />
                                  </IconButton>
                                  <IconButton
                                    label={row.is_active ? t('users.deactivate') : t('users.activate')}
                                    size="sm"
                                    variant={row.is_active ? 'danger' : 'ghost'}
                                    disabled={selfBlocked || isLastAdmin}
                                    title={selfBlocked ? t('users.selfHint') : isLastAdmin ? t('users.adminProtected') : undefined}
                                    onClick={() => {
                                      if (row.is_active) setDeactivateTarget(row)
                                      else statusMutation.mutate({ id: row.id, is_active: true })
                                    }}
                                  >
                                    <Power size={13} />
                                  </IconButton>
                                </>
                              ) : (
                                <span className="text-[0.64rem] text-muted">{t('users.readOnlyRole')}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </TabPanel>
      ) : (
        <TabPanel>
          <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <Panel className="h-fit p-2">
              <p className="px-2.5 pb-2 pt-1.5 text-[0.6rem] font-bold uppercase tracking-[0.14em] text-muted">{t('users.selectRole')}</p>
              <div className="space-y-1">
                {roles.map((role) => {
                  const count = role.key === 'admin' ? allPermissionKeys.length : rolePermissions[role.id]?.length ?? 0
                  const active = role.id === selectedRoleId
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => selectRole(role)}
                      className={
                        active
                          ? 'w-full rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5 text-start transition'
                          : 'w-full rounded-xl border border-transparent px-3 py-2.5 text-start transition hover:border-border hover:bg-surface-2'
                      }
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          {role.key === 'admin' ? <ShieldCheck size={14} className="shrink-0 text-accent" /> : <Users size={14} className="shrink-0 text-muted" />}
                          <span className={active ? 'truncate text-[0.76rem] font-semibold text-accent' : 'truncate text-[0.76rem] font-semibold text-text'}>{roleLabel(role)}</span>
                        </span>
                        <span className="shrink-0 text-[0.6rem] tabular text-muted">{count}</span>
                      </span>
                      <span className="mt-1 block truncate text-[0.62rem] leading-relaxed text-muted">
                        {role.key === 'admin' ? t('users.fullAccessRole') : role.key === 'viewer' ? t('users.readOnlyRole') : role.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </Panel>

            <Panel className="p-4 sm:p-5">
              {selectedRole ? (
                <>
                  <SectionHeader
                    title={roleLabel(selectedRole)}
                    hint={t('users.roleDescription')}
                    action={
                      <div className="flex items-center gap-2">
                        <Badge tone={roleIsProtected ? 'accent' : 'neutral'}>
                          {roleIsProtected ? t('users.adminProtected') : `${effectiveDraft.length} ${t('users.permissionsCount')}`}
                        </Badge>
                      </div>
                    }
                  />

                  {roleIsProtected ? (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent-softer px-3 py-2.5">
                      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />
                      <p className="text-[0.7rem] leading-relaxed text-text-soft">{t('users.protectedRole')}</p>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-3">
                    {permissionsByModule.map(({ module, items }) => {
                      const moduleKeys = items.map((item) => item.key)
                      const checkedCount = moduleKeys.filter((key) => effectiveDraft.includes(key)).length
                      const allChecked = checkedCount === moduleKeys.length
                      return (
                        <div key={module} className="rounded-xl border border-border bg-surface-2/40 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                            <div className="flex items-center gap-2">
                              <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-text-soft">
                                {MODULE_LABELS[module] ? t(MODULE_LABELS[module]) : module}
                              </p>
                              <span className="text-[0.6rem] tabular text-muted">{checkedCount}/{items.length}</span>
                            </div>
                            <Checkbox
                              checked={allChecked}
                              disabled={!canManage || roleIsProtected}
                              onChange={(checked) => toggleModule(items, checked)}
                              label={<span className="text-[0.64rem] font-medium text-muted">{t('common.all')}</span>}
                            />
                          </div>
                          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                            {items.map((item) => (
                              <Checkbox
                                key={item.key}
                                checked={effectiveDraft.includes(item.key)}
                                disabled={!canManage || roleIsProtected}
                                onChange={(checked) => togglePermission(item.key, checked)}
                                label={language === 'ar' ? item.name_ar : item.name_en}
                                description={item.key}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
                    <p className="text-[0.65rem] text-muted">
                      {roleIsProtected ? t('users.protectedRole') : `${savedPermissions.length} ${t('users.permissionsCount')}`}
                    </p>
                    {canManage && !roleIsProtected ? (
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(savedPermissions)}>
                          {t('common.reset')}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Check size={13} />}
                          disabled={!dirty}
                          loading={permissionMutation.isPending}
                          onClick={() => permissionMutation.mutate()}
                        >
                          {t('users.savePermissions')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState icon={<Search size={20} />} title={t('users.empty')} hint={t('users.emptyHint')} />
              )}
            </Panel>
          </div>
        </TabPanel>
      )}

      <Modal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        title={editing ? t('users.editUser') : t('users.addUser')}
        description={editing ? editing.email : t('users.subtitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setFormOpen(false)
                setEditing(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={saveUserMutation.isPending} onClick={submitUser}>
              {editing ? t('common.saveChanges') : t('common.create')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('users.fullName')} required>
              <Input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} autoComplete="name" />
            </Field>
            <Field label={t('users.email')} required>
              <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} autoComplete="email" />
            </Field>
            <Field label={t('users.role')} required hint={editing && editing.id === currentUser?.id ? t('users.selfHint') : undefined}>
              <Select
                value={form.role_id}
                disabled={editing?.id === currentUser?.id}
                onChange={(event) => setForm({ ...form, role_id: event.target.value })}
              >
                {!editing ? <option value="" disabled>{t('users.selectRolePlaceholder')}</option> : null}
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {roleLabel(role)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('users.accountStatus')}>
              <div className="flex h-[38px] items-center rounded-xl border border-border bg-surface-2/60 px-3">
                <Switch
                  checked={form.is_active}
                  disabled={editing?.id === currentUser?.id}
                  onChange={(checked) => setForm({ ...form, is_active: checked })}
                  label={form.is_active ? t('users.active') : t('users.inactive')}
                />
              </div>
            </Field>
          </div>

          <Field
            label={editing ? t('users.newPassword') : t('users.password')}
            required={!editing}
            hint={editing ? t('users.passwordHint') : t('users.passwordMin')}
          >
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              placeholder={editing ? t('common.optional') : undefined}
            />
          </Field>

          {editing?.id === currentUser?.id ? (
            <p className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[0.68rem] leading-relaxed text-warning">
              {t('users.selfHint')}
            </p>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(passwordTarget)}
        onClose={() => {
          setPasswordTarget(null)
          setNewPassword('')
        }}
        title={t('users.resetPassword')}
        description={passwordTarget ? `${passwordTarget.full_name} · ${passwordTarget.email}` : undefined}
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setPasswordTarget(null)
                setNewPassword('')
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={passwordMutation.isPending} onClick={submitPassword}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Field label={t('users.newPassword')} required hint={t('users.passwordMin')}>
          <Input
            type="password"
            autoFocus
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (deactivateTarget) statusMutation.mutate({ id: deactivateTarget.id, is_active: false })
        }}
        title={t('users.deactivate')}
        description={
          <span className="space-y-2">
            <span className="block">{t('users.deactivateWarning')}</span>
            {deactivateTarget ? (
              <span className="block text-[0.72rem] text-muted">
                {deactivateTarget.full_name} · {deactivateTarget.email}
              </span>
            ) : null}
          </span>
        }
        confirmLabel={t('users.deactivate')}
        loading={statusMutation.isPending}
      />
    </div>
  )
}
