'use client'

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Large natural-language search field. */
export function SearchBar({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder = 'Describe a moment: “where I explain the export settings”…',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <form
      className="big-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <Search size={18} aria-hidden className="bs-icon" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search your footage by meaning"
        data-testid="library-search"
        autoFocus={autoFocus}
        maxLength={200}
      />
      {value && (
        <button type="button" className="icon-button bs-clear" aria-label="Clear search" onClick={() => onChange('')}>
          <X size={15} />
        </button>
      )}
      <Button type="submit" loading={busy} data-testid="library-search-submit">
        Search
      </Button>
    </form>
  )
}
