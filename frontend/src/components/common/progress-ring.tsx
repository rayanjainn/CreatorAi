export function ProgressRing({ percent, label }: { percent: number; label?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div
      className="ring"
      style={{ ['--v' as string]: v }}
      role="img"
      aria-label={label ?? `${v}% of the production checklist done`}
      title={label ?? `${v}% of the production checklist done`}
    >
      <span>{v}</span>
    </div>
  )
}
