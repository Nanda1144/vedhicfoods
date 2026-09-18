import { useMemo, useState } from 'react'
import { adminService } from '@/services/adminService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDate, formatCurrency } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar, ConfirmDialog } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Delivery, DeliveryStatus } from '@/types'
import { Badge, Button, Icon, Modal, Skeleton } from '@/components/common'
import { Field, Select } from '@/components/common/form'

const PAGE_SIZE = 8
const STATUS_FILTERS: Array<DeliveryStatus | 'all'> = ['all', 'unassigned', 'assigned', 'picked-up', 'in-transit', 'delivered', 'failed']

export function AdminDeliveryPage() {
  const { can } = useAdminAuth()
  const { push } = useToast()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<DeliveryStatus | 'all'>('all')
  const [page, setPage] = useState(1)
  const [assigning, setAssigning] = useState<Delivery | null>(null)
  const [partnerId, setPartnerId] = useState('')
  const [delivering, setDelivering] = useState<Delivery | null>(null)
  const [busy, setBusy] = useState(false)

  const deliveries = useAsync(() => adminService.deliveries(), [])
  const partners = useAsync(() => adminService.deliveryPartners(), [])
  const orders = useAsync(() => adminService.orders(), [])

  const activePartners = partners.data ?? []

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (deliveries.data ?? []).filter((delivery) => {
      if (
        query &&
        !`${delivery.orderNumber} ${delivery.customerName} ${delivery.city} ${delivery.partnerName ?? ''}`
          .toLowerCase()
          .includes(query)
      )
        return false
      if (status !== 'all' && delivery.status !== status) return false
      return true
    })
  }, [deliveries.data, search, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const assign = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!assigning) return
    setBusy(true)
    try {
      const partner = activePartners.find((candidate) => candidate.id === partnerId)
      await adminService.updateDelivery(assigning.id, {
        partnerId,
        partnerName: partner?.name,
        status: 'assigned',
        trackingNumber: partner?.vehicle
          ? `${assigning.orderNumber.replace(/[^0-9]/g, '')}-TRK-${String(Math.floor(Math.random() * 900) + 100)}`
          : assigning.trackingNumber,
      })
      push({
        title: 'Delivery assigned',
        description: `${assigning.orderNumber} → ${partner?.name ?? 'partner'}`,
      })
      setAssigning(null)
      await deliveries.run()
    } finally {
      setBusy(false)
    }
  }

  const markFailed = async (delivery: Delivery) => {
    setBusy(true)
    try {
      await adminService.updateDelivery(delivery.id, { status: 'failed' })
      push({ title: 'Delivery marked failed', description: `${delivery.orderNumber} will need a re-attempt or return.` })
      setDelivering(null)
      await deliveries.run()
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<Delivery>> = [
    {
      key: 'delivery',
      header: 'Delivery',
      sortValue: (delivery) => delivery.orderNumber,
      render: (delivery) => (
        <span>
          <strong>#{delivery.id.replace('dlv-', '').toUpperCase()}</strong>
          <span className="type-caption" style={{ display: 'block' }}>{delivery.orderNumber}</span>
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', render: (delivery) => (
      <span>
        <strong>{delivery.customerName}</strong>
        <span className="type-caption" style={{ display: 'block' }}>{delivery.city}</span>
      </span>
    ) },
    {
      key: 'partner',
      header: 'Partner',
      render: (delivery) => (delivery.partnerName ? delivery.partnerName : <Badge tone="warning" dot>Unassigned</Badge>),
    },
    {
      key: 'expected',
      header: 'Expected',
      render: (delivery) => <span className="type-caption">{formatDate(delivery.expectedAt)}</span>,
    },
    { key: 'status', header: 'Status', render: (delivery) => <StatusPill status={delivery.status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (delivery) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {can('delivery:write') && (
            <Button size="sm" variant="ghost" icon="truck" onClick={() => { setAssigning(delivery); setPartnerId(delivery.partnerId ?? '') }}>
              {delivery.partnerId ? 'Reassign' : 'Assign'}
            </Button>
          )}
          {can('delivery:write') && delivery.status !== 'delivered' && delivery.status !== 'failed' && (
            <Button size="sm" variant="ghost" icon="ban" onClick={() => setDelivering(delivery)} aria-label={`Fail ${delivery.orderNumber}`} />
          )}
        </span>
      ),
    },
  ]

  if (deliveries.loading && !deliveries.data) {
    return (
      <>
        <AdminPageHeader title="Delivery" description="Assign partners and track last-mile fulfilment." />
        <section className="admin-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))}
        </section>
      </>
    )
  }

  if (deliveries.error) {
    return (
      <>
        <AdminPageHeader title="Delivery" description="Assign partners and track last-mile fulfilment." />
        <p className="admin-note admin-note--error">{deliveries.error.message}</p>
      </>
    )
  }

  const delivered = (deliveries.data ?? []).filter((delivery) => delivery.status === 'delivered').length
  const inTransit = (deliveries.data ?? []).filter((delivery) => delivery.status === 'in-transit' || delivery.status === 'picked-up').length
  const unassigned = (deliveries.data ?? []).filter((delivery) => delivery.status === 'unassigned').length

  return (
    <>
      <AdminPageHeader
        title="Delivery"
        description={`${delivered} delivered · ${inTransit} in transit · ${unassigned} awaiting assignment`}
      />

      <section className="admin-grid admin-grid--2" style={{ marginBottom: 16 }}>
        {activePartners.map((partner) => (
          <article key={partner.id} className="admin-card partner-card">
            <header className="partner-card__head">
              <span className="admin-avatar-sm">{partner.name.split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</span>
              <span>
                <strong>{partner.name}</strong>
                <span className="type-caption" style={{ display: 'block' }}>
                  {partner.phone}{partner.vehicle ? ` · ${partner.vehicle}` : ''}
                </span>
              </span>
              <Badge tone={partner.active ? 'success' : 'neutral'} dot>
                {partner.active ? 'On duty' : 'Off duty'}
              </Badge>
            </header>
          </article>
        ))}
      </section>

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search order, customer or city…"
        filters={[{ label: 'Status', value: status, options: STATUS_FILTERS.filter((value) => value !== 'all') as string[], onChange: (value) => setStatus(value as DeliveryStatus | 'all') }]}
      />

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(delivery) => delivery.id}
          caption="Deliveries"
          footer={<PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        />
      </section>

      {assigning && (
        <Modal
          open
          onClose={() => setAssigning(null)}
          title={`Assign partner — ${assigning.orderNumber}`}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setAssigning(null)} disabled={busy}>
                Cancel
              </Button>
              <Button icon="truck" onClick={assign} loading={busy}>
                Assign partner
              </Button>
            </>
          }
        >
          <form className="admin-form" onSubmit={assign} noValidate>
            <p className="admin-muted" style={{ marginTop: 0 }}>
              Deliver to <strong>{assigning.customerName}</strong> in {assigning.city}.
              {can('orders:read') && orders.data ? (
                <>
                  {' '}
                  Order total{' '}
                  {formatCurrency(
                    orders.data.find((order) => order.id === assigning.orderId)?.total ?? 0,
                  )}
                  .
                </>
              ) : null}
            </p>
            <Field label="Delivery partner">
              <Select
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
                aria-label="Delivery partner"
                placeholder="Select a partner…"
                options={activePartners.map((partner) => ({
                  value: partner.id,
                  label: `${partner.name}${partner.vehicle ? ` · ${partner.vehicle}` : ''}`,
                }))}
              />
            </Field>
            {assigning.trackingNumber && (
              <p className="type-caption row" style={{ gap: 6 }}>
                <Icon name="info" size={14} /> Current tracking: {assigning.trackingNumber}
              </p>
            )}
          </form>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(delivering)}
        title={`Mark ${delivering?.orderNumber} as failed?`}
        message="A failed attempt will be flagged for re-delivery or customer contact."
        confirmLabel="Mark failed"
        tone="danger"
        loading={busy}
        onConfirm={() => delivering && void markFailed(delivering)}
        onClose={() => setDelivering(null)}
      />
    </>
  )
}