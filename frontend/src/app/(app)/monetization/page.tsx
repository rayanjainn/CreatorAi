import { NotAvailablePage } from '@/components/common/not-available'

export default function MonetizationPage() {
  return (
    <NotAvailablePage
      eyebrow="CreatorAI / Grow"
      title="Monetization"
      summary="Sponsor matching and sponsorship slot finding are not built yet. There are no sample brands or rates on this page because none would be real."
      willDo={['Find natural sponsor-read slots inside a finished video', 'Draft an integration script and lower-third for each slot', 'Remind you about paid-promotion disclosure when you publish']}
      needs={['Sponsors backend (not built yet)', 'Matched script and footage (available now)']}
    />
  )
}
