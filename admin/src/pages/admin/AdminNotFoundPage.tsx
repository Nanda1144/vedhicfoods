import { AdminPageHeader } from '@/components/admin'
import { Button } from '@/components/common'
import { Link } from 'react-router-dom'

export function AdminNotFoundPage() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center' }}>
      <AdminPageHeader
        title="404 — Page Not Found"
        description="The administrative resource or dashboard screen you requested does not exist."
      />
      <div style={{ marginTop: '24px' }}>
        <Link to="/">
          <Button variant="primary">Return to Admin Dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
