'use client'

import { useParams } from 'next/navigation'
import { EditorPage } from '@/components/editor/editor-page'

export default function Page() {
  const { clipId } = useParams<{ clipId: string }>()
  return <EditorPage clipId={clipId} />
}
