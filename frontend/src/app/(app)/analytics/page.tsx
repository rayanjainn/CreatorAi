import { NotAvailablePage } from '@/components/common/not-available'

export default function AnalyticsPage() {
  return (
    <NotAvailablePage
      eyebrow="CreatorAI / Grow"
      title="Analytics"
      summary="Channel analytics and AI insights are not built yet, and CreatorAi will not invent numbers for them. Once they exist, every figure will say whether it is real YouTube data or seeded demo data."
      willDo={['Sync your real YouTube performance (views, retention, watch time)', 'Show which hooks, lengths and topics work best for you', 'Suggest the next ideas to put on your board, with caveats on small samples']}
      needs={['YouTube connection (not built yet)', 'Insights backend (not built yet)']}
    />
  )
}
