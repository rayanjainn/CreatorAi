import { NotAvailablePage } from '@/components/common/not-available'

export default function ProjectSponsorsPage() {
  return (
    <NotAvailablePage
      eyebrow="Project"
      title="Sponsors"
      summary="Sponsor slot finding for this project is not built yet."
      willDo={['Suggest natural sponsor-read moments', 'Draft the integration script and lower-third', 'Add the paid-promotion disclosure']}
      needs={['Sponsors backend (not built yet)']}
    />
  )
}
