'use client'

import type { ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import { cn } from '@/lib/utils'

export { Menu }

export function MenuPopup({
  children,
  className,
  align = 'end',
  side = 'bottom',
}: {
  children: ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <Menu.Portal>
      <Menu.Positioner side={side} align={align} sideOffset={8} style={{ zIndex: 60 }}>
        <Menu.Popup className={cn('menu-popup', className)}>{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export function MenuItem({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <Menu.Item className={cn('menu-item', danger && 'danger')} onClick={onClick} disabled={disabled}>
      {children}
    </Menu.Item>
  )
}
