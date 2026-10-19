import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { adminService } from '@/services/adminService'
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

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, staff: 1, customer: 0 }

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

  const canWrite = can('staff.update')
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
     } catch (caught) {
       push({ title: 'Could not complete action', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
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
          {canWrite && member.id !== selfId && (ROLE_RANK[member.role] ?? 0) < (ROLE_RANK[session?.role ?? 'customer'] ?? 0) && (
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
          {canWrite && ((member.id === selfId) || (ROLE_RANK[member.role] ?? 0) < (ROLE_RANK[session?.role ?? 'customer'] ?? 0)) && (
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
        <AdminPageHeader title="Staff management" description="Create staff accounts and control who can sign in." />
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
        <AdminPageHeader title="Staff management" description="Create staff accounts and control who can sign in." />
        <p className="admin-note admin-note--error">{staff.error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader
        title="Staff management"
        description={`${staff.data!.filter((member) => member.status === 'active').length} active · ${staff.data!.filter((member) => member.status === 'suspended').length} suspended`}
        actions={
          canWrite && (
            <Button icon="plus" onClick={() => setInviteOpen(true)}>
              Add staff
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
            options: ['active', 'suspended'],
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
          No invitation email is sent. Create the account, set the login password, and share the
          credentials with the staff member yourself — they sign in with them. Staff cannot change their
          own password; an administrator resets it from this page.
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

/**
 * Default permission set for a role, taken from the role rows returned by the
 * API (`GET /admin/roles`) instead of a hardcoded map. The previous map keyed
 * defaults on invented roles (`manager`, `viewer`, `inventory`, `support`) that
 * do not exist in the RoleName enum, and the create form defaulted to `manager`
 * — so submitting an invite without touching the role select sent an invalid
 * enum and the API rejected it.
 */
function roleDefaults(
  roles: Array<{ name: RoleName; permissions?: Permission[] }>,
  role: RoleName,
): Permission[] {
  return roles.find((candidate) => candidate.name === role)?.permissions ?? []
}

function InviteModal({
  roles,
  onClose,
  onSaved,
}: {
  roles: Array<{ name: RoleName; label: string; permissions?: Permission[] }>
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const defaultRole: RoleName =
    roles.find((candidate) => candidate.name === 'staff')?.name ?? roles[0]?.name ?? 'staff'
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    role: defaultRole,
    photo: '',
    address: '',
  })
  const [permissions, setPermissions] = useState<Permission[]>(roleDefaults(roles, defaultRole))
  const [saving, setSaving] = useState(false)

  const togglePermission = (permission: Permission) => {
    setPermissions((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission],
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()

    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    const passwordValid =
      form.password.length >= 8 && /[A-Za-z]/.test(form.password) && /[0-9]/.test(form.password)

    if (form.name.trim().length < 2 || !emailValid || !passwordValid) {
      push({
        title: 'Check the form',
        description:
          'Enter a full name, a valid work email, and a login password of at least 8 characters containing a letter and a number.',
        tone: 'danger',
      })
      return
    }

    setSaving(true)
    try {
      // OWNER/ADMIN targets inherit every permission by role, so the API refuses a
      // per-user grant set for them. Omit permissions in that case.
      const privileged = form.role === 'owner' || form.role === 'admin'
      const effectivePermissions = permissions.length > 0 ? [...permissions] : roleDefaults(roles, form.role)
      const payload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        password: form.password,
        role: form.role,
        status: 'active' as const,
        employeeId: `EMP-${String(302 + Math.floor(Math.random() * 900))}`,
        permissions: privileged ? undefined : effectivePermissions,
        photo: form.photo,
        address: form.address.trim(),
        createdAt: new Date().toISOString(),
      }
      await adminService.createStaff(payload)
      push({ title: 'Staff account created', description: `${form.name} can now sign in as ${form.role}.` })
      onSaved()
    } catch (caught) {
      push({ title: 'Could not create account', description: caught instanceof Error ? caught.message : 'Please try again.', tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a new staff member"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button icon="check" type="submit" form="invite-form" loading={saving}>
            Create account
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
           <Field label="Login password" required hint="Set the password the staff member signs in with (at least 8 characters, one letter and one number).">
             <Input type="password" value={form.password} onChange={(event) => setForm((c) => ({ ...c, password: event.target.value }))} required minLength={8} />
           </Field>
          <Field label="Role" required hint="The role's default permissions are preselected. Adjust below.">
            <Select
              value={form.role}
              onChange={(event) => {
                const nextRole = event.target.value as RoleName
                setForm((c) => ({ ...c, role: nextRole }))
                setPermissions([...roleDefaults(roles, nextRole)])
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
  roles: Array<{ name: RoleName; label: string; permissions?: Permission[] }>
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [role, setRole] = useState<RoleName>(member.role)
  const [status, setStatus] = useState<StaffMember['status']>(member.status === 'suspended' ? 'suspended' : 'active')
  const [permissions, setPermissions] = useState<Permission[]>(
    member.permissions ?? roleDefaults(roles, member.role),
  )
  const [saving, setSaving] = useState(false)

  const defaultForRole = roleDefaults(roles, role)
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
      // OWNER/ADMIN targets inherit every permission by role; the API refuses a
      // per-user grant set for them, so only send permissions for STAFF targets.
      const privileged = role === 'owner' || role === 'admin'
      await adminService.updateStaff(member.id, {
        role,
        status,
        permissions: privileged ? undefined : permissions.length > 0 ? [...permissions] : undefined,
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