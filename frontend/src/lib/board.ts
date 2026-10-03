import type { Board, Card, Stage } from '@/lib/api/types'

/** Pure optimistic move: returns a new board with `id` placed at `position` (default end) of `stage`. */
export function applyMove(board: Board, id: string, stage: Stage, position?: number): Board {
  let moving: Card | undefined
  const stripped = board.columns.map((col) => {
    const found = col.cards.find((c) => c.id === id)
    if (found) moving = found
    return { ...col, cards: col.cards.filter((c) => c.id !== id) }
  })
  if (!moving) return board
  const card = moving
  const columns = stripped.map((col) => {
    if (col.stage !== stage) return { ...col, count: col.cards.length }
    const at = position == null ? col.cards.length : Math.max(0, Math.min(position, col.cards.length))
    const cards = [...col.cards]
    cards.splice(at, 0, { ...card, stage })
    return { ...col, cards: cards.map((c, i) => ({ ...c, position: i })), count: cards.length }
  })
  return { ...board, columns }
}

export function flattenBoard(board: Board | undefined): Card[] {
  return board ? board.columns.flatMap((c) => c.cards) : []
}

export function findCard(board: Board | undefined, id: string): Card | undefined {
  return flattenBoard(board).find((c) => c.id === id)
}
