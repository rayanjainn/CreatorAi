'use client'

import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { NotAvailableInline } from '@/components/common/not-available'
import { Bot } from 'lucide-react'

/** Right slide-over reserved for the Creative Twin chat. The Twin backend is not built yet: say so honestly. */
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
            <NotAvailableInline title="Not available yet" icon={<Bot size={16} />}>
              The Creative Twin learns your voice from your scripts and published videos. Its chat and style-profile backend are not built
              yet, so there is nothing to talk to. This panel will open from anywhere in the app once it ships.
            </NotAvailableInline>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
