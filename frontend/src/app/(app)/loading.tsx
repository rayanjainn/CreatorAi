import { Skeleton } from '@/components/ui/skeleton'

export default function Loading() {
  return (
    <div className="page" aria-busy aria-label="Loading">
      <Skeleton style={{ height: 34, width: 280 }} />
      <Skeleton style={{ height: 220, borderRadius: 18 }} />
      <div className="project-grid">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ height: 240, borderRadius: 15 }} />
        ))}
      </div>
    </div>
  )
}
