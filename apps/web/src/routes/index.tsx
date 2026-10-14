import { usePowerSync, useQuery as usePowerSyncQuery } from '@powersync/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { api } from '../api/client'
import { pushNotice } from '../components/noticeStore'
import type { ShowRow } from '../powersync/schema'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const { data: shows, isLoading } = usePowerSyncQuery<ShowRow>(
    'SELECT * FROM shows ORDER BY title',
  )
  const active = shows.filter((s) => s.status !== 'archived')
  const archived = shows.filter((s) => s.status === 'archived')

  return (
    <>
      <h1>Shows</h1>
      <NewShow />
      {isLoading ? (
        <p>Loading…</p>
      ) : (
        <>
          <ShowList label="Active shows" shows={active} empty="No shows yet." />
          {archived.length > 0 && (
            <>
              <h2>Archived</h2>
              <ShowList label="Archived shows" shows={archived} empty="" />
            </>
          )}
        </>
      )}
    </>
  )
}

function ShowList({ label, shows, empty }: { label: string; shows: ShowRow[]; empty: string }) {
  if (shows.length === 0) return <p>{empty}</p>
  return (
    <ul aria-label={label} className="show-list">
      {shows.map((show) => (
        <ShowItem key={show.id} show={show} />
      ))}
    </ul>
  )
}

function ShowItem({ show }: { show: ShowRow }) {
  const db = usePowerSync()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')

  async function save(e: FormEvent) {
    e.preventDefault()
    const next = title.trim()
    setEditing(false)
    if (!next || next === show.title) return
    // Local write first; PowerSync queues it and uploads when online.
    await db.execute('UPDATE shows SET title = ? WHERE id = ?', [next, show.id])
  }

  if (editing) {
    return (
      <li>
        <form onSubmit={save}>
          <input
            aria-label="Show title"
            // biome-ignore lint/a11y/noAutofocus: the user just asked to rename this show
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="submit">Save</button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      </li>
    )
  }
  return (
    <li>
      <Link to="/shows/$showId" params={{ showId: show.id }}>
        {show.title}
      </Link>
      <button
        type="button"
        aria-label={`Rename ${show.title}`}
        onClick={() => {
          setTitle(show.title ?? '')
          setEditing(true)
        }}
      >
        Rename
      </button>
    </li>
  )
}

function NewShow() {
  const [title, setTitle] = useState('')
  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api.get<{ organisations: { id: string; name: string }[] }>('/me/orgs'),
  })
  const create = useMutation({
    mutationFn: (t: string) => {
      const org = orgs.data?.organisations[0]
      if (!org) throw new Error('You have no organisation to create a show in')
      // The new show reaches the list through sync, like every other row.
      return api.post(`/orgs/${org.id}/shows`, { title: t })
    },
    onSuccess: () => setTitle(''),
    onError: (err) =>
      pushNotice({ kind: 'error', message: `Could not create the show: ${err.message}` }),
  })

  return (
    <form
      className="new-show"
      onSubmit={(e) => {
        e.preventDefault()
        if (title.trim()) create.mutate(title.trim())
      }}
    >
      <input
        aria-label="New show title"
        placeholder="New show title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button type="submit" disabled={create.isPending || !orgs.data}>
        New show
      </button>
    </form>
  )
}
