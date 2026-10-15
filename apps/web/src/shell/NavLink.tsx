import { type LinkOptions, useLinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

/**
 * A router link whose "current" state the shell decides. TanStack's own active matching is by path
 * prefix, so it would mark Script current on every page of the show, and two destinations that open
 * the same page (Script and Docs, for now) would both light up.
 */
export function NavLink({
  link,
  active,
  className,
  title,
  label,
  children,
}: {
  link: LinkOptions
  active: boolean
  className?: string
  title?: string
  /** An accessible name, for a link that has only an icon. */
  label?: string
  children: ReactNode
}) {
  const props = useLinkProps(link)
  return (
    <a
      {...props}
      href={props.href}
      className={className}
      title={title}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-status={active ? 'active' : undefined}
    >
      {children}
    </a>
  )
}
