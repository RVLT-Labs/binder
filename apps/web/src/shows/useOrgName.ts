import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'

const key = (email: string) => `binder.orgName.${email}`

function read(email: string): string | undefined {
  try {
    return localStorage.getItem(key(email)) || undefined
  } catch {
    return undefined
  }
}

/**
 * The name of the person's organisation (the first one, as the new show dialog uses), for the
 * shows home's over-label. The last answer is kept on the device so it still shows offline.
 */
export function useOrgName(email: string): string | undefined {
  const [remembered] = useState(() => read(email))
  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api.get<{ organisations: { id: string; name: string }[] }>('/me/orgs'),
  })
  const name = orgs.data?.organisations[0]?.name
  useEffect(() => {
    if (!name) return
    try {
      localStorage.setItem(key(email), name)
    } catch {
      // storage blocked: the label just does not survive offline
    }
  }, [email, name])
  return name ?? remembered
}
