'use client'

import { useMemo } from 'react'
import { useBoard } from '@/lib/api/hooks'
import { flattenBoard } from '@/lib/board'
import type { Card } from '@/lib/api/types'

/** Every project card (newest first) plus an id to title map for hubs that list rows of many projects. */
export function useProjects() {
  const board = useBoard()
  const cards = useMemo<Card[]>(() => flattenBoard(board.data).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [board.data])
  const titles = useMemo(() => new Map(cards.map((c) => [c.id, c.title])), [cards])
  return { board, cards, titles }
}
