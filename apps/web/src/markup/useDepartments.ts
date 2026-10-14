import { useQuery } from '@powersync/react'
import type { Database } from '../powersync/schema'

export type DepartmentRow = Database['departments']

/** A show's departments from the local database, in display order. Hidden ones are included. */
export function useDepartments(showId: string): DepartmentRow[] {
  const { data } = useQuery<DepartmentRow>(
    'SELECT * FROM departments WHERE show_id = ? ORDER BY sort_order, code',
    [showId],
  )
  return data
}
