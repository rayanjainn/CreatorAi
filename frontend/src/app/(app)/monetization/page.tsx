import { NotAvailablePage } from '@/components/common/not-available'

export default function Page() {
  return (
    <NotAvailablePage
      eyebrow="Grow"
      title="Monetization"
      summary="Sponsorship tools are being rebuilt on the real backend. The previous screen showed sample brands, payouts and contacts that were not real."
      willDo={[
        'Track brand deals from first pitch to paid',
        'Write sponsor pitches and integration scripts from your own numbers',
        'Find the best sponsor slots in your footage and drop them into a clip',
      ]}
    />
  )
}
