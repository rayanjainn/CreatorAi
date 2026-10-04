'use client'

import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { TwinChat } from '@/components/twin/twin-chat'

/** Right slide-over with the Creative Twin chat, reachable from anywhere. */
export function TwinDrawer() {
  const open = useUi((s) => s.twinOpen)
  const setOpen = useUi((s) => s.setTwinOpen)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="drawer-backdrop" />
        <Dialog.Popup className="drawer" data-testid="twin-drawer">
          <div className="drawer-head">
            <div>
              <div className="eyebrow violet-text">Creative Twin</div>
              <Dialog.Title render={<h2 />}>Chat with your Twin</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="drawer-body">
            <TwinChat compact />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
