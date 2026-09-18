import { useAsync } from '@/hooks'
import { adminService } from '@/services/adminService'
import { AdminPageHeader } from '@/components/admin'
import type { Permission, Role } from '@/types'
import { PERMISSIONS } from '@/data/admin'
import { Icon, Skeleton } from '@/components/common'

const ROLE_ORDER: Role['name'][] = ['owner', 'admin', 'manager', 'inventory', 'support', 'viewer']

export function AdminPermissionsPage() {
  const { data, loading, error } = useAsync(() => adminService.roles(), [])
  const roles = data ?? []

  const rows: { permission: Permission; granted: string[] }[] = PERMISSIONS.map((permission) => ({
    permission,
    granted: ROLE_ORDER.filter((name) => {
      const role = roles.find((candidate) => candidate.name === name)
      return role?.permissions.includes(permission)
    }),
  }))

  if (loading && !data) {
    return (
      <>
        <AdminPageHeader title="Roles & permissions" description="What each role can and cannot access." />
        <section className="admin-card">
          <Skeleton style={{ width: '100%', height: 420 }} />
        </section>
      </>
    )
  }

  if (error) {
    return (
      <>
        <AdminPageHeader title="Roles & permissions" description="What each role can and cannot access." />
        <p className="admin-note admin-note--error">{error.message}</p>
      </>
    )
  }

  return (
    <>
      <AdminPageHeader title="Roles & permissions" description="System roles map to a fixed set of capabilities." />

      <section className="admin-alert is-info" style={{ marginBottom: 16 }}>
        <Icon name="shield" size={16} />
        <span>
          The <strong>owner</strong> always has every permission. Other roles follow the matrix below; individual staff
          members can be fine-tuned with custom overrides on the Staff screen.
        </span>
      </section>

      <section className="admin-card">
        <div className="table-scroll">
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
        </div>
      </section>
    </>
  )
}