import { NotAvailablePage } from '@/components/common/not-available'

export default function ProjectPublishPage() {
  return (
    <NotAvailablePage
      eyebrow="Project"
      title="Publish"
      summary="Publishing to YouTube is not built yet. You can already render clips and download them once the clips screen ships."
      willDo={['Schedule or publish a render to YouTube with title, description and tags', 'Track upload progress and show the live link', 'Offer download-only presets for Reels and TikTok']}
      needs={['YouTube connection and publishing backend (not built yet)']}
    />
  )
}
