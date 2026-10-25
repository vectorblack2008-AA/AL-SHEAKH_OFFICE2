import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useToast } from '../context/ToastContext'
import { api, errorMessage } from '../lib/api'
import type { Customer } from '../lib/types'
import { Button, Field, Input, Modal, Select, Textarea } from './ui'
import type { TranslationKey } from '../i18n/translations'

interface CustomerForm {
  name: string
  type: string
  contact_name: string
  phone: string
  email: string
  tax_id: string
  address: string
  notes: string
}

const TYPES = ['company', 'institution', 'individual'] as const

function emptyForm(): CustomerForm {
  return {
    name: '',
    type: 'company',
    contact_name: '',
    phone: '',
    email: '',
    tax_id: '',
    address: '',
    notes: '',
  }
}

function formFromCustomer(customer: Customer): CustomerForm {
  return {
    name: customer.name,
    type: customer.type || 'company',
    contact_name: customer.contact_name ?? '',
    phone: customer.phone ?? '',
    email: customer.email ?? '',
    tax_id: customer.tax_id ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
  }
}

/**
 * Shared customer create/edit dialog used by contracts, trips and revenue.
 * The customer list is owned by the server, so every save invalidates it.
 */
export function CustomerModal({
  open,
  onClose,
  customer,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  customer?: Customer | null
  onSaved?: (customer: Customer) => void
}) {
  const { t } = useApp()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CustomerForm>(emptyForm)

  useEffect(() => {
    if (!open) return
    setForm(customer ? formFromCustomer(customer) : emptyForm())
  }, [open, customer])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      customer ? api.patch<Customer>(`/api/customers/${customer.id}`, payload) : api.post<Customer>('/api/customers', payload),
    onSuccess: (saved) => {
      toast.success(t('common.saved'))
      void queryClient.invalidateQueries({ queryKey: ['customers'] })
      void queryClient.invalidateQueries({ queryKey: ['contracts'] })
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      void queryClient.invalidateQueries({ queryKey: ['revenue'] })
      onSaved?.(saved)
      onClose()
    },
    onError: (error) => toast.error(t('error.save'), errorMessage(error)),
  })

  function submit() {
    if (!form.name.trim()) {
      toast.error(t('error.validation'), t('common.required'))
      return
    }
    saveMutation.mutate({
      name: form.name.trim(),
      type: form.type,
      contact_name: form.contact_name.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      tax_id: form.tax_id.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? t('customer.editCustomer') : t('customer.addCustomer')}
      description={t('customer.manageHint')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" icon={<UserPlus size={14} />} loading={saveMutation.isPending} onClick={submit}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.name')} required className="sm:col-span-2">
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} autoFocus />
        </Field>
        <Field label={t('common.type')}>
          <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            {TYPES.map((type) => (
              <option key={type} value={type}>{t(`customer.${type}` as TranslationKey)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('customer.contactName')}>
          <Input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} />
        </Field>
        <Field label={t('customer.phone')}>
          <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} dir="ltr" />
        </Field>
        <Field label={t('customer.email')}>
          <Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} dir="ltr" />
        </Field>
        <Field label={t('customer.taxId')}>
          <Input value={form.tax_id} onChange={(event) => setForm({ ...form, tax_id: event.target.value })} dir="ltr" />
        </Field>
        <Field label={t('customer.address')}>
          <Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />
        </Field>
        <Field label={t('common.notes')} className="sm:col-span-2">
          <Textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}
