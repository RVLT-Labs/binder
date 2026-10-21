import { type ConnectorStyle, connectorStyle } from '@binder/shared'
import { parseSettings } from './stampSettings'

/** A department's connector style from a show's `settings` JSON text: thin and solid unless it says otherwise. */
export function readConnectorStyle(
  settings: string | null | undefined,
  departmentId: string,
): ConnectorStyle {
  return connectorStyle(parseSettings(settings), departmentId)
}

/** The show's `settings` JSON text with one department's connector style replaced; every other setting is kept. */
export function withConnectorStyle(
  settings: string | null | undefined,
  departmentId: string,
  style: ConnectorStyle,
): string {
  const current = parseSettings(settings)
  const styles = current.connectorStyles
  const kept =
    styles && typeof styles === 'object' && !Array.isArray(styles)
      ? (styles as Record<string, unknown>)
      : {}
  return JSON.stringify({
    ...current,
    connectorStyles: { ...kept, [departmentId]: { width: style.width, pattern: style.pattern } },
  })
}
