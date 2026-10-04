import { KeyRound } from 'lucide-react'

/** Shown instead of the studio when the server has no LumiClip key. */
export function LumiclipSetupCard() {
  return (
    <section className="card sc-setup" data-testid="lumiclip-setup">
      <span className="sc-setup-icon">
        <KeyRound size={18} />
      </span>
      <div>
        <h2>Connect LumiClip to clip links in the cloud</h2>
        <p>
          LumiClip cuts short clips out of a long video <b>link</b> (YouTube and others) without downloading anything to your computer. It is optional: the Smart Clips tab for your own
          projects works without it.
        </p>
        <ol>
          <li>
            Create a key in your LumiClip account.
          </li>
          <li>
            Put it in <code>.env</code> as <code>LUMICLIP_API_KEY=…</code> (the key stays on the server, never in the browser).
          </li>
          <li>Restart the API (<code>make dev</code>) and reload this page.</li>
        </ol>
        <small>To clip a video from your library instead of a link, also set the three <code>CLOUDINARY_*</code> values: LumiClip needs a public URL, so the file is uploaded to your Cloudinary first.</small>
      </div>
    </section>
  )
}
