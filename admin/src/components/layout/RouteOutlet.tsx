import { Suspense } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Skeleton } from '../common'

export function RouteOutlet() {
  const location = useLocation()
  return (
    <Suspense fallback={<PageSkeleton />}>
      <div className="page-transition" key={location.pathname}>
        <Outlet />
      </div>
    </Suspense>
  )
}

function PageSkeleton() {
  return (
    <div className="page-loading" aria-busy="true">
      <div className="container stack stack-4" style={{ paddingBlock: 'clamp(3rem, 6vw, 6rem)' }}>
        <Skeleton style={{ width: '42%', height: 16 }} />
        <Skeleton style={{ width: '64%', height: 44 }} />
        <Skeleton style={{ width: '78%', height: 18 }} />
        <Skeleton style={{ width: '100%', height: 320, borderRadius: 20, marginTop: 12 }} />
      </div>
    </div>
  )
}