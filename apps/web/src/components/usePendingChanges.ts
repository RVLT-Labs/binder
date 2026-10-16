import { useQuery } from '@powersync/react'

/** How many local changes are still waiting to upload: PowerSync's `ps_crud` has one row per change. */
export function usePendingChanges(): number {
  const { data } = useQuery<{ n: number }>('SELECT count(*) AS n FROM ps_crud')
  return data[0]?.n ?? 0
}
