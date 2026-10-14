import { useState } from 'react'
import { contentAdminService } from '@/services/contentAdminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDate } from '@/utils/format'
import { AdminPageHeader, AdminToolbar, ConfirmDialog, DataTable, PaginationBar, StatusPill } from '@/components/admin'
import type { Column } from '@/components/admin'
import { Badge, Button, Modal, Skeleton, Tabs } from '@/components/common'
import { Field, Input, Select, Switch, Textarea } from '@/components/common/form'
import type { AdminFaq, AdminReview, AdminSubscriber, AdminTestimonial, ReviewModerationStatus } from '@/types'

const PAGE_SIZE = 8

export function AdminContentPage() {
  const { can } = useAdminAuth()
  const canEdit = can('content.update')

  return (
    <>
      <AdminPageHeader
        title="Website content"
        description="Testimonials, FAQs, product reviews and newsletter subscribers shown on the storefront."
      />

      <Tabs
        variant="pill"
        items={[
          { id: 'testimonials', label: 'Testimonials', content: <TestimonialsTab canEdit={canEdit} /> },
          { id: 'faqs', label: 'FAQs', content: <FaqsTab canEdit={canEdit} /> },
          { id: 'reviews', label: 'Reviews', content: <ReviewsTab canEdit={canEdit} /> },
          { id: 'subscribers', label: 'Newsletter', content: <SubscribersTab canEdit={canEdit} /> },
        ]}
      />
    </>
  )
}

/* =========================================================== Testimonials */

function TestimonialsTab({ canEdit }: { canEdit: boolean }) {
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<AdminTestimonial | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AdminTestimonial | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, loading, error, run } = useAsync(() => contentAdminService.testimonials(), [])

  const filtered = (data ?? []).filter((t) => {
    const query = search.trim().toLowerCase()
    return !query || `${t.name} ${t.location} ${t.quote}`.toLowerCase().includes(query)
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await contentAdminService.deleteTestimonial(deleting.id)
      push({ title: 'Testimonial deleted', description: `“${deleting.name}” was removed.` })
      setDeleting(null)
      await run()
    } catch (caught) {
      push({ title: 'Could not delete', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<AdminTestimonial>> = [
    { key: 'name', header: 'Author', render: (t) => <span><strong>{t.name}</strong><span className="type-caption" style={{ display: 'block' }}>{t.location}</span></span> },
    { key: 'quote', header: 'Quote', render: (t) => <span className="type-caption">{t.quote.length > 90 ? `${t.quote.slice(0, 90)}…` : t.quote}</span> },
    { key: 'rating', header: 'Rating', align: 'right', sortValue: (t) => t.rating, render: (t) => `${t.rating} / 5` },
    { key: 'featured', header: 'Featured', align: 'center', render: (t) => (t.isFeatured ? <Badge tone="accent" dot>Featured</Badge> : <span className="type-caption">—</span>) },
    { key: 'state', header: 'Status', render: (t) => <StatusPill status={t.isActive ? 'active' : 'disabled'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (t) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {canEdit && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(t)}>Edit</Button>}
          {canEdit && <Button size="sm" variant="ghost" icon="trash" aria-label={`Delete ${t.name}`} onClick={() => setDeleting(t)} />}
        </span>
      ),
    },
  ]

  if (loading && !data) return <TabSkeleton />
  if (error) return <TabError message={error.message} />

  return (
    <>
      <AdminToolbar
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1) }}
        searchPlaceholder="Search name, location or quote…"
      >
        {canEdit && <Button icon="plus" onClick={() => setEditing('new')}>New testimonial</Button>}
      </AdminToolbar>
      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(t) => t.id}
          caption="Customer testimonials"
          footer={<PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        />
      </section>

      {editing && (
        <TestimonialModal
          testimonial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await run() }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete testimonial?"
        message={deleting ? `“${deleting.name}” will be removed from the storefront permanently.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function TestimonialModal({ testimonial, onClose, onSaved }: { testimonial: AdminTestimonial | null; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const isNew = testimonial === null
  const [form, setForm] = useState({
    name: testimonial?.name ?? '',
    location: testimonial?.location ?? '',
    quote: testimonial?.quote ?? '',
    rating: testimonial?.rating ?? 5,
    avatarUrl: testimonial?.avatarUrl ?? '',
    isActive: testimonial?.isActive ?? true,
    isFeatured: testimonial?.isFeatured ?? false,
    sortOrder: testimonial?.sortOrder ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const patch = (key: keyof typeof form, value: unknown) => setForm((c) => ({ ...c, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim(),
        quote: form.quote.trim(),
        rating: Number(form.rating),
        avatarUrl: form.avatarUrl.trim() || null,
        isActive: form.isActive,
        isFeatured: form.isFeatured,
        sortOrder: Number(form.sortOrder),
      }
      if (isNew) {
        await contentAdminService.createTestimonial(payload)
        push({ title: 'Testimonial created' })
      } else {
        await contentAdminService.updateTestimonial(testimonial!.id, payload)
        push({ title: 'Testimonial updated' })
      }
      onSaved()
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New testimonial' : 'Edit testimonial'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button icon="check" form="testimonial-form" loading={saving}>{isNew ? 'Create' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="testimonial-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__grid">
          <Field label="Name" required>
            <Input value={form.name} onChange={(e) => patch('name', e.target.value)} required />
          </Field>
          <Field label="Location">
            <Input value={form.location} onChange={(e) => patch('location', e.target.value)} placeholder="City, State" />
          </Field>
          <Field label="Rating" required>
            <Select
              value={String(form.rating)}
              onChange={(e) => patch('rating', Number(e.target.value))}
              options={[5, 4, 3, 2, 1].map((v) => ({ value: String(v), label: `${v} star${v === 1 ? '' : 's'}` }))}
            />
          </Field>
          <Field label="Sort order" hint="Lower shows first.">
            <Input type="number" min="0" value={form.sortOrder} onChange={(e) => patch('sortOrder', Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Quote" required>
          <Textarea value={form.quote} onChange={(e) => patch('quote', e.target.value)} rows={4} required />
        </Field>
        <Field label="Avatar URL" hint="Optional. Initials are generated automatically otherwise.">
          <Input value={form.avatarUrl ?? ''} onChange={(e) => patch('avatarUrl', e.target.value)} placeholder="https://…" />
        </Field>
        <div className="row" style={{ gap: 16 }}>
          <Switch label="Visible on storefront" checked={form.isActive} onCheckedChange={(v) => patch('isActive', v)} />
          <Switch label="Featured" checked={form.isFeatured} onCheckedChange={(v) => patch('isFeatured', v)} />
        </div>
      </form>
    </Modal>
  )
}

/* ================================================================ FAQs */

function FaqsTab({ canEdit }: { canEdit: boolean }) {
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<AdminFaq | 'new' | null>(null)
  const [deleting, setDeleting] = useState<AdminFaq | null>(null)
  const [busy, setBusy] = useState(false)
  const { data, loading, error, run } = useAsync(() => contentAdminService.faqs(), [])

  const categories = [...new Set((data ?? []).map((f) => f.category))].sort()
  const filtered = (data ?? []).filter((f) => {
    const query = search.trim().toLowerCase()
    if (query && !`${f.question} ${f.answer}`.toLowerCase().includes(query)) return false
    if (category && f.category !== category) return false
    return true
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await contentAdminService.deleteFaq(deleting.id)
      push({ title: 'FAQ deleted' })
      setDeleting(null)
      await run()
    } catch (caught) {
      push({ title: 'Could not delete', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<AdminFaq>> = [
    { key: 'question', header: 'Question', render: (f) => <span><strong>{f.question}</strong><span className="type-caption" style={{ display: 'block' }}>{f.answer.length > 100 ? `${f.answer.slice(0, 100)}…` : f.answer}</span></span> },
    { key: 'category', header: 'Category', render: (f) => <Badge tone="info">{f.category}</Badge> },
    { key: 'order', header: 'Order', align: 'right', sortValue: (f) => f.sortOrder, render: (f) => f.sortOrder },
    { key: 'state', header: 'Status', render: (f) => <StatusPill status={f.isActive ? 'active' : 'disabled'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (f) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {canEdit && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(f)}>Edit</Button>}
          {canEdit && <Button size="sm" variant="ghost" icon="trash" aria-label="Delete FAQ" onClick={() => setDeleting(f)} />}
        </span>
      ),
    },
  ]

  if (loading && !data) return <TabSkeleton />
  if (error) return <TabError message={error.message} />

  return (
    <>
      <AdminToolbar
        search={search}
        onSearch={(value) => { setSearch(value); setPage(1) }}
        searchPlaceholder="Search question or answer…"
        filters={[{ label: 'Category', value: category, options: categories, onChange: (v) => { setCategory(v); setPage(1) } }]}
      >
        {canEdit && <Button icon="plus" onClick={() => setEditing('new')}>New FAQ</Button>}
      </AdminToolbar>
      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(f) => f.id}
          caption="Frequently asked questions"
          footer={<PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        />
      </section>

      {editing && (
        <FaqModal
          faq={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await run() }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete FAQ?"
        message={deleting ? `“${deleting.question}” will be removed from the storefront permanently.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busy}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

function FaqModal({ faq, categories, onClose, onSaved }: { faq: AdminFaq | null; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const { push } = useToast()
  const isNew = faq === null
  const [form, setForm] = useState({
    question: faq?.question ?? '',
    answer: faq?.answer ?? '',
    category: faq?.category ?? (categories[0] ?? 'Products'),
    sortOrder: faq?.sortOrder ?? 0,
    isActive: faq?.isActive ?? true,
  })
  const [saving, setSaving] = useState(false)
  const patch = (key: keyof typeof form, value: unknown) => setForm((c) => ({ ...c, [key]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category.trim(),
        sortOrder: Number(form.sortOrder),
        isActive: form.isActive,
      }
      if (isNew) {
        await contentAdminService.createFaq(payload)
        push({ title: 'FAQ created' })
      } else {
        await contentAdminService.updateFaq(faq!.id, payload)
        push({ title: 'FAQ updated' })
      }
      onSaved()
    } catch (caught) {
      push({ title: 'Could not save', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New FAQ' : 'Edit FAQ'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button icon="check" form="faq-form" loading={saving}>{isNew ? 'Create' : 'Save changes'}</Button>
        </>
      }
    >
      <form id="faq-form" className="admin-form" onSubmit={submit} noValidate>
        <Field label="Question" required>
          <Input value={form.question} onChange={(e) => patch('question', e.target.value)} required />
        </Field>
        <Field label="Answer" required>
          <Textarea value={form.answer} onChange={(e) => patch('answer', e.target.value)} rows={5} required />
        </Field>
        <div className="admin-form__grid">
          <Field label="Category" hint="Existing categories are suggested.">
            <Input list="faq-categories" value={form.category} onChange={(e) => patch('category', e.target.value)} required />
          </Field>
          <Field label="Sort order" hint="Lower shows first within a category.">
            <Input type="number" min="0" value={form.sortOrder} onChange={(e) => patch('sortOrder', Number(e.target.value))} />
          </Field>
        </div>
        <datalist id="faq-categories">
          {categories.map((c) => <option key={c} value={c} />)}
        </datalist>
        <Switch label="Visible on storefront" checked={form.isActive} onCheckedChange={(v) => patch('isActive', v)} />
      </form>
    </Modal>
  )
}

/* ============================================================= Reviews */

function ReviewsTab({ canEdit }: { canEdit: boolean }) {
  const { push } = useToast()
  const [status, setStatus] = useState<ReviewModerationStatus>('pending')
  const [deleting, setDeleting] = useState<AdminReview | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { data, loading, error, run } = useAsync(() => contentAdminService.reviews(status), [status])

  const moderate = async (review: AdminReview, isApproved: boolean) => {
    setBusyId(review.id)
    try {
      await contentAdminService.moderateReview(review.id, { isApproved })
      push({ title: isApproved ? 'Review approved' : 'Review rejected', description: review.productName })
      await run()
    } catch (caught) {
      push({ title: 'Could not moderate', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await contentAdminService.deleteReview(deleting.id)
      push({ title: 'Review deleted' })
      setDeleting(null)
      await run()
    } catch (caught) {
      push({ title: 'Could not delete', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const rows = data?.items ?? []
  const columns: Array<Column<AdminReview>> = [
    { key: 'product', header: 'Product', render: (r) => <span><strong>{r.productName ?? 'Product'}</strong><span className="type-caption" style={{ display: 'block' }}>{r.customerName}{r.customerEmail ? ` · ${r.customerEmail}` : ''}</span></span> },
    { key: 'rating', header: 'Rating', align: 'right', sortValue: (r) => r.rating, render: (r) => `${r.rating} / 5` },
    { key: 'title', header: 'Review', render: (r) => <span><strong>{r.title}</strong><span className="type-caption" style={{ display: 'block' }}>{r.body.length > 90 ? `${r.body.slice(0, 90)}…` : r.body}</span></span> },
    { key: 'date', header: 'Submitted', render: (r) => <span className="type-caption">{formatDate(r.createdAt)}</span> },
    { key: 'state', header: 'Status', render: (r) => <StatusPill status={r.approved ? 'active' : status === 'rejected' ? 'rejected' : 'review'} label={r.approved ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Pending'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {canEdit && !r.approved && <Button size="sm" variant="ghost" icon="check" loading={busyId === r.id} onClick={() => void moderate(r, true)}>Approve</Button>}
          {canEdit && r.approved && <Button size="sm" variant="ghost" icon="trash" onClick={() => void moderate(r, false)}>Unpublish</Button>}
          {canEdit && !r.approved && status !== 'rejected' && <Button size="sm" variant="ghost" icon="trash" onClick={() => void moderate(r, false)}>Reject</Button>}
          {canEdit && <Button size="sm" variant="ghost" icon="trash" aria-label="Delete review" onClick={() => setDeleting(r)} />}
        </span>
      ),
    },
  ]

  if (loading && !data) return <TabSkeleton />
  if (error) return <TabError message={error.message} />

  return (
    <>
      <AdminToolbar
        search=""
        onSearch={() => undefined}
        searchPlaceholder="Filter by status below…"
        filters={[{ label: 'Status', value: status, options: ['pending', 'approved', 'rejected', 'all'], onChange: (v) => setStatus(v as ReviewModerationStatus) }]}
      >
        <Badge tone={status === 'pending' ? 'warning' : 'info'} dot>{rows.length} shown</Badge>
      </AdminToolbar>
      <section className="admin-card">
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Product reviews awaiting moderation" />
      </section>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete review?"
        message={deleting ? `The review by “${deleting.customerName}” will be removed permanently.` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busyId === deleting?.id}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

/* ========================================================= Subscribers */

function SubscribersTab({ canEdit }: { canEdit: boolean }) {
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<AdminSubscriber | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { data, loading, error, run } = useAsync(() => contentAdminService.subscribers(), [])

  const filtered = (data?.items ?? []).filter((s) => {
    const query = search.trim().toLowerCase()
    return !query || `${s.email} ${s.name ?? ''}`.toLowerCase().includes(query)
  })

  const unsubscribe = async (sub: AdminSubscriber) => {
    setBusyId(sub.id)
    try {
      await contentAdminService.unsubscribeSubscriber(sub.id)
      push({ title: 'Unsubscribed', description: sub.email })
      await run()
    } catch (caught) {
      push({ title: 'Could not unsubscribe', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusyId(deleting.id)
    try {
      await contentAdminService.deleteSubscriber(deleting.id)
      push({ title: 'Subscriber deleted', description: deleting.email })
      setDeleting(null)
      await run()
    } catch (caught) {
      push({ title: 'Could not delete', description: caught instanceof Error ? caught.message : 'Try again.', tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<Column<AdminSubscriber>> = [
    { key: 'email', header: 'Email', render: (s) => <strong>{s.email}</strong> },
    { key: 'name', header: 'Name', render: (s) => s.name || <span className="type-caption">—</span> },
    { key: 'source', header: 'Source', render: (s) => <Badge tone="neutral">{s.source}</Badge> },
    { key: 'joined', header: 'Joined', render: (s) => <span className="type-caption">{formatDate(s.createdAt)}</span> },
    { key: 'state', header: 'Status', render: (s) => <StatusPill status={s.active ? 'active' : 'disabled'} label={s.active ? 'Subscribed' : 'Unsubscribed'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {canEdit && s.active && <Button size="sm" variant="ghost" loading={busyId === s.id} onClick={() => void unsubscribe(s)}>Unsubscribe</Button>}
          {canEdit && <Button size="sm" variant="ghost" icon="trash" aria-label="Delete subscriber" onClick={() => setDeleting(s)} />}
        </span>
      ),
    },
  ]

  if (loading && !data) return <TabSkeleton />
  if (error) return <TabError message={error.message} />

  return (
    <>
      <AdminToolbar search={search} onSearch={setSearch} searchPlaceholder="Search email or name…">
        <Badge tone="accent" dot>{data?.total ?? 0} subscribers</Badge>
      </AdminToolbar>
      <section className="admin-card">
        <DataTable columns={columns} rows={filtered} rowKey={(s) => s.id} caption="Newsletter subscribers" />
      </section>
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete subscriber?"
        message={deleting ? `“${deleting.email}” will be permanently erased (GDPR-style hard delete).` : ''}
        confirmLabel="Delete"
        tone="danger"
        loading={busyId === deleting?.id}
        onConfirm={() => void doDelete()}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}

/* =========================================================== Helpers */

function TabSkeleton() {
  return (
    <section className="admin-card">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
      ))}
    </section>
  )
}

function TabError({ message }: { message: string }) {
  return <p className="admin-note admin-note--error">{message}</p>
}