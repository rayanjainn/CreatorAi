import { NotAvailablePage } from '@/components/common/not-available'

export default function CreativeTwinPage() {
  return (
    <NotAvailablePage
      eyebrow="CreatorAI / Grow"
      title="Creative Twin"
      summary="Your Digital Twin, a style profile and chat assistant that learns your voice, is not built yet. The memories seeded by `make seed` exist in the database but nothing reads them in the UI."
      willDo={['Learn your tone, pacing and vocabulary from approved scripts', 'Chat about ideas in your voice, with suggestions you apply explicitly', 'Show and let you edit your style profile']}
      needs={['Twin chat and style-profile backend (not built yet)']}
    />
  )
}
