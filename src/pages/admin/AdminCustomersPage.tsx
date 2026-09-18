import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { useAsync } from '@/hooks'
import { formatCurrency, formatDate, initials } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, AdminToolbar, PaginationBar } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Customer } from '@/types'
import { Skeleton } from '@/components/common'

const PAGE_SIZE = 10

export function AdminCustomersPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)

  const { data, loading, error } = useAsync(() => adminService.customers(), [])

  const { filtered, highValue } = useMemo(() => {
    const customers = data ?? []
    const query = search.trim().toLowerCase()
    const filteredList = customers.filter((customer) => {
      if (query && !`${customer.name} ${customer.email} ${customer.phone}`.toLowerCase().includes(query)) return false
      if (status && customer.status !== status) return false
      return true
    })
    const top = [...customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5)
    return { filtered: filteredList, highValue: top }
  }, [data, search, status])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const columns: Array<Column<Customer>> = [
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (customer) => customer.name,
      render: (customer) => (
        <Link to={`/admin/customers/${customer.id}`} className="admin-product-cell">
          <span className="admin-avatar-sm">{initials(customer.name, 2)}</span>
          <span>
            <strong>{customer.name}</strong>
            <span className="type-caption">{customer.email}</span>
          </span>
        </Link>
      ),
    },
    { key: 'phone', header: 'Phone', render: (customer) => <span className="type-caption">{customer.phone}</span> },
    {
      key: 'orders',
      header: 'Orders',
      align: 'right',
      sortValue: (customer) => customer.orderCount,
      render: (customer) => customer.orderCount,
    },
    {
      key: 'spend',
      header: 'Lifetime spend',
      align: 'right',
      sortValue: (customer) => customer.totalSpent,
      render: (customer) => <strong>{formatCurrency(customer.totalSpent)}</strong>,
    },
    {
      key: 'joined',
      header: 'Joined',
      render: (customer) => <span className="type-caption">{formatDate(customer.joinedAt)}</span>,
    },
    {
      key: 'marketing',
      header: 'Marketing',
      render: (customer) => (customer.marketingOptIn ? <StatusPill status="success" label="Opted in" /> : <span className="type-caption">—</span>),
    },
    { key: 'status', header: 'Status', render: (customer) => <StatusPill status={customer.status} /> },
  ]

  return (
    <>
      <AdminPageHeader
        title="Customers"
        description={`${data?.length ?? 0} customer accounts in total.`}
      />

      <AdminToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder="Search name, email or phone…"
        filters={[{ label: 'Status', value: status, options: ['active', 'inactive', 'blocked'], onChange: setStatus }]}
      />

      <section className="admin-card">
        {loading && !data ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))
        ) : error ? (
          <p className="admin-note admin-note--error">{error.message}</p>
        ) : (
          <DataTable
            columns={columns}
            rows={paged}
            rowKey={(customer) => customer.id}
            caption="Customer accounts"
            footer={
              <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
            }
          />
        )}
      </section>

      <section className="admin-card">
        <header className="admin-card__head">
          <h2>Top customers by lifetime spend</h2>
          <span className="admin-card__hint">value segment</span>
        </header>
        <ul className="top-products">
          {highValue.map((customer, index) => (
            <li key={customer.id}>
              <span className="top-products__rank">{index + 1}</span>
              <span className="admin-avatar-sm">{initials(customer.name, 2)}</span>
              <span className="top-products__name">
                <strong>{customer.name}</strong>
                <span className="type-caption">{customer.orderCount} orders</span>
              </span>
              <strong>{formatCurrency(customer.totalSpent)}</strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}