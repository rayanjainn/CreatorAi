import { Suspense } from 'react'
import { AppShell } from '@/components/shell/app-shell'
import { RequireAuth } from '@/components/shell/require-auth'
import { Splash } from '@/components/common/splash'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<Splash />}>
      <RequireAuth>
        <AppShell>{children}</AppShell>
      </RequireAuth>
    </Suspense>
  )
}
