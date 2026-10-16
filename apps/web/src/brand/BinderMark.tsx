/**
 * The Binder mark: a monoline B whose two bowls are the rings of a binder hung on the spine, on the
 * RVLT red tile. The same geometry as public/favicon.svg and the icons scripts/make-icons.mjs draws.
 *
 * Decorative by default (aria-hidden); pass a `title` for an accessible name when it stands alone.
 */
export function BinderMark({ title, className }: { title?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <rect width="512" height="512" rx="116" fill="#E0363D" />
      <g fill="none" stroke="#F5EFE2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M170 131V381" strokeWidth="50" />
        <path
          d="M170 131H262A60 60 0 0 1 262 251H170M170 251H282A65 65 0 0 1 282 381H170"
          strokeWidth="44"
        />
      </g>
    </svg>
  )
}
