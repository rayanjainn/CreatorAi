import type { CaptionStyle, RenderPreset } from '@/lib/api/types'

/** Mirror of backend/app/media/presets.py (docs/API.md). The server stays the authority: it answers DURATION_EXCEEDS_PRESET. */
export const PRESETS: { id: RenderPreset; label: string; aspect: string; size: string; max: number | null; captions: CaptionStyle; where: string }[] = [
  { id: 'yt_short', label: 'YouTube Short', aspect: '9:16', size: '1080×1920', max: 60, captions: 'bold_center', where: 'Publishable to YouTube' },
  { id: 'reels', label: 'Instagram Reels', aspect: '9:16', size: '1080×1920', max: 90, captions: 'bold_center', where: 'Download and post yourself' },
  { id: 'tiktok', label: 'TikTok', aspect: '9:16', size: '1080×1920', max: 60, captions: 'karaoke', where: 'Download and post yourself' },
  { id: 'yt_long', label: 'YouTube video', aspect: '16:9', size: '1920×1080', max: null, captions: 'minimal_bottom', where: 'Publishable to YouTube' },
]

export const CAPTION_STYLES: { id: CaptionStyle; label: string }[] = [
  { id: 'bold_center', label: 'Bold center' },
  { id: 'minimal_bottom', label: 'Minimal bottom' },
  { id: 'karaoke', label: 'Karaoke highlight' },
]
