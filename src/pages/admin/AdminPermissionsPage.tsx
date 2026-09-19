import { useState } from 'react'
import { useAsync } from '@/hooks'
import { adminService } from '@/services/adminService'
import { AdminPageHeader } from '@/components/admin'
import { useToast } from '@/context'
import type { Permission, Role, StaffMember } from '@/types'
import { PERMISSIONS } from '@/data/admin'
import { Button, Icon, Skeleton } from '@/components/common'

const ROLE_ORDER: Role['name'][] = ['owner', 'admin', 'manager', 'inventory', 'support', 'viewer']

export function AdminPermissionsPage() {
  const { push } = useToast()
  const [view, setView] = useState<'role' | 'person'>('role')

  const roleQuery = useAsync(() => adminService.roles(), [])
  const staffQuery = useAsync(() => adminService.staff(), [])
  const roles = roleQuery.data ?? []
  const staff = staffQuery.data ?? []

  if (roleQuery.loading && !roleQuery.data) {
    return (
      <>
        <AdminPageHeader title="Roles & permissions" description="What each role and person can and cannot access." />
        <section className="admin-card">
          <Skeleton style={{ width: '100%', height: 420 }} />
        </section>
      </>
    )
  }

  if (roleQuery.error) {
    return (
      <>
        <AdminPageHeader title="Roles & permissions" description="What each role and person can and cannot access." />
        <p className="admin-note admin-note--error">{roleQuery.error.message}</p>
      </>
    )
  }

  const rows: { permission: Permission; granted: string[] }[] = PERMISSIONS.map((permission) => ({
    permission,
    granted: ROLE_ORDER.filter((name) => {
      const role = roles.find((candidate) => candidate.name === name)
      return role?.permissions.includes(permission)
    }),
  }))

  const effectivePermissions = (member: StaffMember): Set<Permission> => {
    if (member.permissions && member.permissions.length > 0) return new Set(member.permissions)
    const role = roles.find((candidate) => candidate.name === member.role)
    return new Set(role?.permissions ?? [])
  }

  const toggleForMember = async (member: StaffMember, permission: Permission) => {
    const current = effectivePermissions(member)
    const next = current.has(permission)
      ? [...current].filter((item) => item !== permission)
      : [...current, permission]
    try {
      await adminService.updateStaff(member.id, { permissions: next.length > 0 ? next : undefined })
      push({
        title: 'Permission updated',
        description: `${member.name} ${current.has(permission) ? 'lost' : 'now has'} ${permission}.`,
      })
      await staffQuery.run()
    } catch (caught) {
      push({
        title: 'Could not update permission',
        description: caught instanceof Error ? caught.message : 'Please try again.',
        tone: 'danger',
      })
      await staffQuery.run()
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Roles & permissions"
        description="System roles map to a fixed set of capabilities."
        actions={
          <Button icon={view === 'role' ? 'users' : 'shield'} onClick={() => setView(view === 'role' ? 'person' : 'role')}>
            {view === 'role' ? 'View by person' : 'View by role'}
          </Button>
        }
      />

      <section className="admin-alert is-info" style={{ marginBottom: 16 }}>
        <Icon name="shield" size={16} />
        <span>
          The <strong>owner</strong> always has every permission. In the by-person view, tick a box to grant or revoke
          that permission for the person — changes apply immediately.
        </span>
      </section>

      <section className="admin-card">
        <div className="table-scroll">
          {view === 'role' ? (
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {ROLE_ORDER.map((name) => (
                    <th key={name} scope="col" className={name === 'owner' ? 'is-owner' : ''}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ permission, granted }) => (
                  <tr key={permission}>
                    <th scope="row">
                      <code>{permission}</code>
                      <span className="perm-matrix__module">{permission.split(':')[0]}</span>
                    </th>
                    {ROLE_ORDER.map((name) => (
                      <td key={name} className={granted.includes(name) ? 'is-granted' : ''} aria-label={granted.includes(name) ? 'Granted' : 'Restricted'}>
                        {name === 'owner' || granted.includes(name) ? (
                          <Icon name="check" size={15} />
                        ) : (
                          <Icon name="minus" size={15} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th scope="col">Permission</th>
                  {staff.map((member) => (
                    <th key={member.id} scope="col" className={member.role === 'owner' ? 'is-owner' : ''}>
                      {member.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSIONS.map((permission) => (
                  <tr key={permission}>
                    <th scope="row">
                      <code>{permission}</code>
                      <span className="perm-matrix__module">{permission.split(':')[0]}</span>
                    </th>
                    {staff.map((member) => {
                      const granted = effectivePermissions(member).has(permission)
                      const isOwner = member.role === 'owner'
                      return (
                        <td key={member.id} className={granted ? 'is-granted' : ''}>
                          <input
                            type="checkbox"
                            aria-label={`${member.name}: ${permission}`}
                            checked={granted}
                            disabled={isOwner}
                            className="perm-check"
                            onChange={() => void toggleForMember(member, permission)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  )
}