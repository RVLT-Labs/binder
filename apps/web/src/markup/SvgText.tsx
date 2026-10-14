import type { SVGProps } from 'react'

export type SvgTextProps = Omit<SVGProps<SVGTextElement>, 'x' | 'y' | 'transform'> & {
  /** Displayed page space: points, y up. */
  x: number
  y: number
}

/**
 * Text inside a PageOverlay, whose group flips y: the text is drawn at the origin and the
 * transform moves it to (x, y) and flips it back, so it reads upright.
 */
export function SvgText({ x, y, children, ...rest }: SvgTextProps) {
  return (
    <text transform={`translate(${x} ${y}) scale(1 -1)`} {...rest}>
      {children}
    </text>
  )
}
