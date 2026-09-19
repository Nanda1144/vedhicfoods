import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { adminService } from '@/services/adminService'
import { adminAuthService } from '@/services/adminAuthService'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { useAsync } from '@/hooks'
import { useToast } from '@/context'
import { formatDate } from '@/utils/format'
import { AdminPageHeader, DataTable, StatusPill, ConfirmDialog, AdminToolbar, PaginationBar, ImageUploadField } from '@/components/admin'
import type { Column } from '@/components/admin'
import type { Permission, RoleName, StaffMember } from '@/types'
import { PERMISSIONS } from '@/data/admin'
import { Badge, Button, Modal, Skeleton, Icon } from '@/components/common'
import { Field, Input, Select, Textarea } from '@/components/common/form'
import { initials } from '@/utils/format'

const PAGE_SIZE = 8

export function AdminStaffPage() {
  const { session, can, refresh } = useAdminAuth()
  const { push } = useToast()
  const { id } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [actOn, setActOn] = useState<{ member: StaffMember; action: 'suspend' | 'activate' | 'delete' } | null>(null)
  const [busy, setBusy] = useState(false)

  const roles = useAsync(() => adminService.roles(), [])
  const staff = useAsync(() => adminService.staff(), [])

  useEffect(() => {
    if (id === 'new') {
      setInviteOpen(true)
    } else if (id) {
      const member = (staff.data ?? []).find((candidate) => candidate.id === id)
      if (member) setEditing(member)
    }
  }, [id, staff.data])

  const canWrite = can('staff:write')
  const selfId = session?.id

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (staff.data ?? []).filter((member) => {
      if (
        query &&
        !`${member.name} ${member.email} ${member.employeeId ?? ''} ${member.role}`.toLowerCase().includes(query)
      )
        return false
      if (roleFilter && member.role !== roleFilter) return false
      if (statusFilter && member.status !== statusFilter) return false
      return true
    })
  }, [staff.data, search, roleFilter, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const doAct = async ({ member, action }: { member: StaffMember; action: 'suspend' | 'activate' | 'delete' }) => {
    setBusy(true)
    try {
      if (action === 'delete') {
        await adminService.deleteStaff(member.id)
        push({ title: 'Staff removed', description: `${member.name} no longer has admin access.` })
      } else {
        const status = action === 'suspend' ? 'suspended' : 'active'
        await adminService.updateStaff(member.id, { status })
        push({
          title: action === 'suspend' ? 'Account suspended' : 'Account reactivated',
          description: `${member.name} can${action === 'suspend' ? ' no longer' : ''} sign in.`,
        })
      }
      setActOn(null)
      await staff.run()
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const columns: Array<Column<StaffMember>> = [
    {
      key: 'member',
      header: 'Member',
      sortValue: (member) => member.name,
      render: (member) => (
        <span className="admin-product-cell">
          <span className="admin-avatar-sm">{initials(member.name, 2)}</span>
          <span>
            <strong>{member.name}</strong>
            <span className="type-caption">{member.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (member) => <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>{member.role}</Badge>,
    },
    { key: 'employeeId', header: 'Employee ID', render: (member) => <span className="type-caption">{member.employeeId ?? '—'}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (member) => <StatusPill status={member.status} label={member.status} />,
    },
    {
      key: 'lastActive',
      header: 'Last active',
      render: (member) =>
        member.lastActiveAt ? <span className="type-caption">{formatDate(member.lastActiveAt)}</span> : <span className="type-caption">—</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (member) => (
        <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
          {canWrite && member.id !== selfId && member.role !== 'owner' && (
            <>
              {member.status === 'suspended' ? (
                <Button size="sm" variant="ghost" icon="check" onClick={() => setActOn({ member, action: 'activate' })}>
                  Activate
                </Button>
              ) : (
                <Button size="sm" variant="ghost" icon="ban" onClick={() => setActOn({ member, action: 'suspend' })}>
                  Suspend
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setActOn({ member, action: 'delete' })} aria-label={`Delete ${member.name}`} />
            </>
          )}
          {member.id === selfId && <span className="type-caption">you</span>}
          {canWrite && (
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(member)}>
              Edit
            </Button>
          )}
        </span>
      ),
    },
  ]

  if (staff.loading && !staff.data) {
    return (
      <>
        <AdminPageHeader title="Staff management" description="Invite teammates and control who can sign in." />
        <section className="admin-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} style={{ width: '100%', height: 44, marginBottom: 8 }} />
          ))}
        </section>
      </>
    )
  }

  if (staff.error) {
    return (
      <>
        <AdminPageHeader title="Staff management" description="Invite teammates and control who can sign in." />
        <p className="admin-note admin-note--error">{staff.error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Staff management"
        description={`${staff.data!.filter((member) => member.status === 'active').length} active · ${staff.data!.filter((member) => member.status === 'invited').length} invited · ${staff.data!.filter((member) => member.status === 'suspended').length} suspended`}
        actions={
          canWrite && (
            <Button icon="plus" onClick={() => setInviteOpen(true)}>
              Invite staff
            </Button>
          )
        }
      />

      <AdminToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search name, email or employee ID…"
        filters={[
          {
            label: 'Role',
            value: roleFilter,
            options: (roles.data ?? []).map((role: { name: string }) => role.name),
            onChange: setRoleFilter,
          },
          {
            label: 'Status',
            value: statusFilter,
            options: ['active', 'invited', 'suspended'],
            onChange: setStatusFilter,
          },
        ]}
      >
        {!canWrite && <span className="type-caption">You have read-only access to staff.</span>}
      </AdminToolbar>

      <section className="admin-card">
        <DataTable
          columns={columns}
          rows={paged}
          rowKey={(member) => member.id}
          caption="Admin staff"
          footer={
            <PaginationBar page={page} pageCount={pageCount} total={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          }
        />
      </section>

      <section className="admin-alert is-info" style={{ marginTop: 4 }}>
        <Icon name="shield" size={16} />
        <span>
          Everyone uses the shared demo password <strong>{adminAuthService.DEMO_PASSWORD}</strong> in this prototype. In
          production, passwords are hashed server-side and invitations are emailed.
        </span>
      </section>

      {canWrite && (
        <>
          {inviteOpen && (
            <InviteModal
              roles={(roles.data ?? []).filter((role: { name: RoleName }) => role.name !== 'owner')}
              onClose={() => {
                setInviteOpen(false)
                navigate('/admin/staff')
              }}
              onSaved={async () => {
                await staff.run()
                setInviteOpen(false)
                navigate('/admin/staff')
              }}
            />
          )}
          {editing && (
            <StaffEditModal
              member={editing}
              roles={(roles.data ?? []).filter((role: { name: RoleName }) => role.name !== 'owner')}
              onClose={() => {
                setEditing(null)
                navigate('/admin/staff')
              }}
              onSaved={async () => {
                await staff.run()
                refresh()
                setEditing(null)
                navigate('/admin/staff')
              }}
            />
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(actOn)}
        title={
          actOn?.action === 'delete'
            ? 'Remove staff member?'
            : actOn?.action === 'suspend'
              ? 'Suspend account?'
              : 'Reactivate account?'
        }
        message={
          actOn
            ? actOn.action === 'delete'
              ? `${actOn.member.name} will lose admin access immediately. Audit logs for their past actions are kept.`
              : actOn.action === 'suspend'
                ? `${actOn.member.name} will not be able to sign in until reactivated.`
                : `${actOn.member.name} will regain access with their assigned role and permissions.`
            : ''
        }
        confirmLabel={actOn?.action === 'delete' ? 'Remove' : actOn?.action === 'suspend' ? 'Suspend' : 'Reactivate'}
        tone={actOn?.action === 'delete' ? 'danger' : 'default'}
        loading={busy}
        onConfirm={() => actOn && void doAct(actOn)}
        onClose={() => setActOn(null)}
      />
    </>
  )
}

const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...PERMISSIONS],
  manager: [
    'products:read', 'products:write', 'categories:read', 'categories:write', 'inventory:read', 'inventory:write',
    'orders:read', 'orders:write', 'customers:read', 'customers:write', 'delivery:read', 'delivery:write',
    'invoices:read', 'invoices:write', 'discounts:read', 'discounts:write', 'promotions:read', 'promotions:write',
    'payments:read', 'support:read', 'support:write',
  ],
  inventory: ['products:read', 'inventory:read', 'inventory:write', 'delivery:read', 'delivery:write', 'orders:read'],
  support: ['support:read', 'support:write', 'orders:read', 'customers:read', 'delivery:read'],
  viewer: ['products:read', 'categories:read', 'orders:read', 'invoices:read', 'inventory:read', 'discounts:read'],
}

function InviteModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: Array<{ name: RoleName; label: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'manager' as RoleName,
    photo: '',
    address: '',
  })
  const [permissions, setPermissions] = useState<Permission[]>(ROLE_DEFAULT_PERMISSIONS[form.role] ?? [])
  const [saving, setSaving] = useState(false)

  const togglePermission = (permission: Permission) => {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission],
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        role: form.role,
        status: 'invited' as const,
        employeeId: `EMP-${String(302 + Math.floor(Math.random() * 900))}`,
        permissions: permissions.length > 0 ? [...permissions] : ROLE_DEFAULT_PERMISSIONS[form.role] ?? [],
        photo: form.photo,
        address: form.address.trim(),
        createdAt: new Date().toISOString(),
      }
      await adminService.createStaff(payload)
      push({ title: 'Invitation sent', description: `${form.name} can now join as ${form.role}.` })
      onSaved()
    } catch (caught) {
      push({ title: 'Could not invite', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a new staff member"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" type="submit" form="invite-form" loading={saving}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__grid">
          <Field label="Full name" required>
            <Input value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} required />
          </Field>
          <Field label="Work email" required>
            <Input type="email" value={form.email} onChange={(event) => setForm((c) => ({ ...c, email: event.target.value }))} required />
          </Field>
          <Field label="Phone">
            <Input type="tel" value={form.phone} onChange={(event) => setForm((c) => ({ ...c, phone: event.target.value }))} placeholder="+91 …" />
          </Field>
          <Field label="Role" required hint="The role's default permissions are preselected. Adjust below.">
            <Select
              value={form.role}
              onChange={(event) => {
                const nextRole = event.target.value as RoleName
                setForm((c) => ({ ...c, role: nextRole }))
                setPermissions([...(ROLE_DEFAULT_PERMISSIONS[nextRole] ?? [])])
              }}
              aria-label="Role"
              options={roles.map((role) => ({ value: role.name, label: role.name }))}
            />
          </Field>
        </div>
        <ImageUploadField
          label="Staff photo"
          hint="A photo so teammates recognise this person. Optional."
          value={form.photo}
          onChange={(photo) => setForm((c) => ({ ...c, photo }))}
        />
        <Field label="Communication address" hint="Postal address for deliveries, dispatch notices and comms. Optional.">
          <Textarea
            rows={3}
            value={form.address}
            onChange={(event) => setForm((c) => ({ ...c, address: event.target.value }))}
            placeholder="House / building, street, area, city, state, PIN…"
          />
        </Field>
        <div className="admin-form__section">
          <p className="admin-form__section-title">Permissions / role assignment</p>
          <p className="admin-muted" style={{ marginTop: 0 }}>
            Tick exactly what this person may do. Starting from the {form.role} role defaults.
          </p>
          <div className="perm-grid">
            {PERMISSIONS.map((permission) => (
              <label key={permission} className="perm-chip">
                <input
                  type="checkbox"
                  checked={permissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                />
                <span>{permission}</span>
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}

function StaffEditModal({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: StaffMember
  roles: Array<{ name: RoleName; label: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [role, setRole] = useState<RoleName>(member.role)
  const [status, setStatus] = useState<StaffMember['status']>(member.status)
  const [permissions, setPermissions] = useState<Permission[]>(member.permissions ?? ROLE_DEFAULT_PERMISSIONS[member.role] ?? [])
  const [saving, setSaving] = useState(false)

  const defaultForRole = ROLE_DEFAULT_PERMISSIONS[role] ?? []
  const usesDefaults = permissions.length === 0 || (role !== member.role && equals(permissions, defaultForRole))

  const togglePermission = (permission: Permission) => {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission],
    )
  }

  const resetToRole = () => setPermissions([...defaultForRole])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await adminService.updateStaff(member.id, {
        role,
        status,
        permissions: permissions.length > 0 ? [...permissions] : undefined,
      })
      push({ title: 'Staff updated', description: `${member.name} saved.` })
      onSaved()
    } catch (caught) {
      push({ title: 'Could not update staff', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${member.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" type="submit" form="edit-staff-form" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-staff-form" className="admin-form" onSubmit={submit} noValidate>
        <div className="admin-form__grid">
          <Field label="Name">
            <Input value={member.name} disabled />
          </Field>
          <Field label="Email">
            <Input value={member.email} disabled />
          </Field>
          <Field label="Role">
            <Select
              value={role}
              onChange={(event) => setRole(event.target.value as RoleName)}
              aria-label="Role"
              options={roles.map((candidate) => ({ value: candidate.name, label: candidate.name }))}
            />
          </Field>
          <Field label="Status">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value as StaffMember['status'])}
              aria-label="Status"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'invited', label: 'Invited (no access yet)' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
          </Field>
        </div>

        <div className="admin-form__section">
          <div className="row row--between">
            <p className="admin-form__section-title">Granular permissions</p>
            <Button size="sm" variant="ghost" icon="refresh" onClick={resetToRole}>
              Reset to role
            </Button>
          </div>
          {usesDefaults && <p className="admin-muted" style={{ margin: 0 }}>Following the {role} role defaults. Tweak below to override.</p>}
          <div className="perm-grid">
            {PERMISSIONS.map((permission) => (
              <label key={permission} className="perm-chip">
                <input
                  type="checkbox"
                  checked={permissions.includes(permission)}
                  onChange={() => togglePermission(permission)}
                />
                <span>{permission}</span>
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  )
}

function equals(a: Permission[], b: Permission[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}