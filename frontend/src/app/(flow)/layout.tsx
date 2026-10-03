import { Suspense } from 'react'
import { RequireAuth } from '@/components/shell/require-auth'
import { Splash } from '@/components/common/splash'

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Splash />}>
      <RequireAuth>{children}</RequireAuth>
    </Suspense>
  )
}
