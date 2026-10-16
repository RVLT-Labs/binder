import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SignOutDeps, signOutAndClear } from '../auth/signOut'
import { clearNotices, pushNotice } from '../components/noticeStore'
import { type Account, AppShell, type Crumb } from './AppShell'
import { useBreakpoint } from './useBreakpoint'

// The sync indicator reads PowerSync, which these tests do not run.
vi.mock('../components/SyncStatus', () => ({ SyncStatus: () => <output>sync</output> }))

/** matchMedia for a window `width` px wide: answers the `(min-width: Npx)` queries the shell asks. */
function setWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: min ? width >= Number(min[1]) : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

const crumbs: Crumb[] = [
  { label: 'Shows', link: { to: '/' }, phoneOnly: true },
  { label: 'Songs for a New World' },
]

const account = (over: Partial<Account> = {}): Account => ({
  email: 'jayden@example.test',
  name: 'Jayden',
  signOut: vi.fn(async () => {}),
  ...over,
})

/** Renders `ui` inside a router sitting at `path`, so the shell's links and current page resolve. */
async function renderAt(path: string, ui: ReactElement) {
  const root = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/' }),
      createRoute({ getParentRoute: () => root, path: '$' }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('main')
}

beforeEach(() => {
  clearNotices()
  localStorage.clear()
  // The router scrolls to the top on load; jsdom does not implement it.
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => clearNotices())

describe('useBreakpoint', () => {
  it.each([
    [390, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1024, 'tablet'],
    [1025, 'desktop'],
    [1440, 'desktop'],
  ])('%ipx is %s', (width, expected) => {
    setWidth(width)
    expect(renderHook(() => useBreakpoint()).result.current).toBe(expected)
  })

  it('defaults to desktop when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => useBreakpoint()).result.current).toBe('desktop')
  })
})

describe('AppShell rail', () => {
  it('is a navigation named Binder at desktop, with the current destination marked', async () => {
    setWidth(1280)
    await renderAt(
      '/shows/s1/cues',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <h1>Cue list</h1>
      </AppShell>,
    )
    const rail = screen.getByRole('navigation', { name: 'Binder' })
    for (const name of ['Script', 'Cues', 'Docs', 'Activity', 'Exports']) {
      expect(within(rail).getByRole('link', { name })).toBeTruthy()
    }
    expect(within(rail).getByRole('link', { name: 'Cues' }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      within(rail).getByRole('link', { name: 'Script' }).getAttribute('aria-current'),
    ).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Show' })).toBeNull()
  })

  it('keeps Script current on a document, which is the script', async () => {
    setWidth(1280)
    await renderAt(
      '/shows/s1/docs/d1',
      <AppShell showId="s1" crumbs={crumbs} account={account()} fullBleed>
        <p>viewer</p>
      </AppShell>,
    )
    const rail = screen.getByRole('navigation', { name: 'Binder' })
    expect(within(rail).getByRole('link', { name: 'Script' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('points Docs at the Documents screen and marks it current there, in the rail and the tab bar', async () => {
    for (const width of [1280, 390]) {
      setWidth(width)
      await renderAt(
        '/shows/s1/docs',
        <AppShell showId="s1" crumbs={crumbs} account={account()}>
          <h1>Documents</h1>
        </AppShell>,
      )
      const nav = screen.getByRole('navigation', { name: width === 390 ? 'Show' : 'Binder' })
      const docs = within(nav).getByRole('link', { name: 'Docs' })
      expect(docs.getAttribute('href')).toBe('/shows/s1/docs')
      expect(docs.getAttribute('aria-current')).toBe('page')
      // Script is no longer lit by a screen that is not the script.
      expect(
        within(nav).getByRole('link', { name: 'Script' }).getAttribute('aria-current'),
      ).toBeNull()
      cleanup()
    }
  })

  it('shows icons only at tablet, with the labels kept as accessible names', async () => {
    setWidth(834)
    await renderAt(
      '/shows/s1/exports',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <h1>Exports</h1>
      </AppShell>,
    )
    const rail = screen.getByRole('navigation', { name: 'Binder' })
    const exports = within(rail).getByRole('link', { name: 'Exports' })
    expect(exports.getAttribute('aria-current')).toBe('page')
    expect(exports.querySelector('.sr-only')?.textContent).toBe('Exports')
    for (const name of ['Script', 'Cues', 'Docs', 'Activity']) {
      expect(within(rail).getByRole('link', { name })).toBeTruthy()
    }
  })

  it('has no show destinations outside a show', async () => {
    setWidth(1280)
    await renderAt(
      '/',
      <AppShell crumbs={[{ label: 'Shows' }]} account={account()}>
        <h1>Shows</h1>
      </AppShell>,
    )
    const rail = screen.getByRole('navigation', { name: 'Binder' })
    expect(within(rail).queryByRole('link', { name: 'Script' })).toBeNull()
    expect(within(rail).getByRole('link', { name: 'Shows' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('draws the destinations of the show last opened outside a show, none of them current', async () => {
    setWidth(1280)
    await renderAt(
      '/',
      <AppShell crumbs={[{ label: 'Shows' }]} account={account()} lastShowId="s9">
        <h1>Shows</h1>
      </AppShell>,
    )
    const rail = screen.getByRole('navigation', { name: 'Binder' })
    for (const name of ['Script', 'Cues', 'Docs', 'Activity', 'Exports']) {
      const link = within(rail).getByRole('link', { name })
      expect(link.getAttribute('href')).toContain('/shows/s9')
      expect(link.getAttribute('aria-current')).toBeNull()
      expect(link.className).toContain('text-muted')
    }
    // Shows is current but keeps the muted colour: the mockup draws no current treatment for it.
    const shows = within(rail).getByRole('link', { name: 'Shows' })
    expect(shows.getAttribute('aria-current')).toBe('page')
    expect(shows.className).toContain('text-muted')
  })
})

describe('AppShell phone', () => {
  it('has a Show tab bar and no rail inside a show', async () => {
    setWidth(390)
    await renderAt(
      '/shows/s1/cues',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <h1>Cue list</h1>
      </AppShell>,
    )
    expect(screen.queryByRole('navigation', { name: 'Binder' })).toBeNull()
    const tabs = screen.getByRole('navigation', { name: 'Show' })
    for (const name of ['Script', 'Cues', 'Docs', 'Activity', 'More']) {
      expect(within(tabs).getByRole('link', { name })).toBeTruthy()
    }
    expect(within(tabs).queryByRole('link', { name: 'Exports' })).toBeNull()
    expect(within(tabs).getByRole('link', { name: 'Cues' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('marks More current on the More screen', async () => {
    setWidth(390)
    await renderAt(
      '/shows/s1/more',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <h1>More</h1>
      </AppShell>,
    )
    const tabs = screen.getByRole('navigation', { name: 'Show' })
    expect(within(tabs).getByRole('link', { name: 'More' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('has no tab bar on the shows list', async () => {
    setWidth(390)
    await renderAt(
      '/',
      <AppShell crumbs={[{ label: 'Shows' }]} account={account()}>
        <h1>Shows</h1>
      </AppShell>,
    )
    expect(screen.queryByRole('navigation', { name: 'Show' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Binder' })).toBeNull()
  })

  it('goes back to the parent crumb with a 44px chevron link', async () => {
    setWidth(390)
    await renderAt(
      '/shows/s1',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <h1>Songs</h1>
      </AppShell>,
    )
    const back = screen.getByRole('link', { name: 'Shows' })
    expect(back.getAttribute('href')).toBe('/')
  })
})

describe('AppShell content area', () => {
  it('is a full-height, non-scrolling area when fullBleed', async () => {
    setWidth(1280)
    await renderAt(
      '/shows/s1/docs/d1',
      <AppShell showId="s1" crumbs={crumbs} account={account()} fullBleed>
        <p>viewer</p>
      </AppShell>,
    )
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-full-bleed')).toBe('true')
    expect(main.className).toContain('overflow-hidden')
  })

  it('scrolls its content otherwise', async () => {
    setWidth(1280)
    await renderAt(
      '/shows/s1',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <p>page</p>
      </AppShell>,
    )
    const main = screen.getByRole('main')
    expect(main.getAttribute('data-full-bleed')).toBeNull()
    expect(main.className).toContain('overflow-y-auto')
  })
})

describe('Notices', () => {
  it('announces a notice and dismisses it', async () => {
    setWidth(1280)
    await renderAt(
      '/shows/s1',
      <AppShell showId="s1" crumbs={crumbs} account={account()}>
        <p>page</p>
      </AppShell>,
    )
    expect(screen.queryByRole('alert')).toBeNull()
    act(() => pushNotice({ kind: 'rejection', message: 'The server refused a change' }))
    expect(screen.getByRole('alert').textContent).toContain('The server refused a change')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

/** Radix menus open on the trigger's pointerdown, which a bare click does not send. */
function openAccountMenu() {
  const trigger = screen.getByRole('button', { name: 'Account menu' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  return trigger
}

function fakeDeps(over: Partial<SignOutDeps>): SignOutDeps {
  return {
    signOut: vi.fn(async () => ({ error: null })),
    clearLocalData: vi.fn(async () => {}),
    clearOutbox: vi.fn(async () => {}),
    clearCache: vi.fn(),
    toLogin: vi.fn(async () => {}),
    pendingUploads: vi.fn(async () => 0),
    confirm: vi.fn(async () => true),
    ...over,
  }
}

describe('AccountMenu', () => {
  beforeEach(() => {
    setWidth(1280)
    // jsdom has no showModal; the shell's confirm opens the dialog either way.
    vi.spyOn(window, 'confirm').mockImplementation(() => {
      throw new Error('sign out must not use window.confirm')
    })
  })

  async function shellWith(deps: SignOutDeps) {
    await renderAt(
      '/shows/s1',
      <AppShell
        showId="s1"
        crumbs={crumbs}
        account={account({ signOut: (confirm) => signOutAndClear({ ...deps, confirm }) })}
      >
        <p>page</p>
      </AppShell>,
    )
  }

  it('shows the email, the tokens page and Sign out', async () => {
    await shellWith(fakeDeps({}))
    openAccountMenu()
    expect(await screen.findByText('jayden@example.test')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Personal access tokens' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeTruthy()
  })

  it('asks in the page when uploads are pending, and signs out once confirmed', async () => {
    const deps = fakeDeps({ pendingUploads: vi.fn(async () => 3) })
    await shellWith(deps)
    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    const message = await screen.findByText("3 changes haven't uploaded yet. Sign out anyway?")
    expect(message).toBeTruthy()
    expect(deps.signOut).not.toHaveBeenCalled()

    const dialog = message.closest('dialog') as HTMLElement
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Sign out' }))
    await vi.waitFor(() => expect(deps.signOut).toHaveBeenCalledTimes(1))
    expect(deps.toLogin).toHaveBeenCalledTimes(1)
  })

  it('stays signed in when the prompt is cancelled', async () => {
    const deps = fakeDeps({ pendingUploads: vi.fn(async () => 1) })
    await shellWith(deps)
    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    const message = await screen.findByText("1 change hasn't uploaded yet. Sign out anyway?")
    const dialog = message.closest('dialog') as HTMLElement
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.queryByText(/uploaded yet/)).toBeNull())
    expect(deps.signOut).not.toHaveBeenCalled()
  })

  it('signs out with no prompt when nothing is pending', async () => {
    const deps = fakeDeps({})
    await shellWith(deps)
    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await vi.waitFor(() => expect(deps.signOut).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/uploaded yet/)).toBeNull()
    expect(window.confirm).not.toHaveBeenCalled()
  })
})

describe('TopBar breadcrumbs', () => {
  it('draws two crumbs that share a label, keyed by position', async () => {
    setWidth(1280)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A document titled like its show.
    await renderAt(
      '/shows/s1/docs/d1',
      <AppShell
        showId="s1"
        crumbs={[
          { label: 'Shows', link: { to: '/' }, phoneOnly: true },
          { label: 'Hamilton', link: { to: '/shows/$showId', params: { showId: 's1' } } },
          { label: 'Hamilton' },
        ]}
        account={account()}
      >
        <p>page</p>
      </AppShell>,
    )
    const trail = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(trail).getAllByText('Hamilton')).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
  })
})

describe('AppShell phone top bar', () => {
  it('a tab-level screen has no back button and a 22 px title; a drill-in has the parent name next to the chevron', async () => {
    setWidth(390)
    await renderAt(
      '/shows/s1/cues',
      <AppShell
        showId="s1"
        crumbs={[
          { label: 'Shows', link: { to: '/' }, phoneOnly: true, backLabel: true },
          { label: 'Cues' },
        ]}
        account={account()}
      >
        <h1>Cue list</h1>
      </AppShell>,
    )
    expect(screen.queryByRole('link', { name: 'Shows' })).toBeNull()
    expect(screen.getByText('Cues', { selector: 'span.font-display' }).className).toContain(
      'text-[22px]',
    )
    cleanup()

    await renderAt(
      '/shows/s1',
      <AppShell
        showId="s1"
        crumbs={[
          { label: 'Shows', link: { to: '/' }, backLabel: true },
          { label: 'Songs for a New World' },
        ]}
        account={account()}
      >
        <h1>Overview</h1>
      </AppShell>,
    )
    const back = screen.getByRole('link', { name: 'Shows' })
    expect(back.textContent).toBe('Shows')
    expect(
      screen.getByText('Songs for a New World', { selector: 'span.font-display' }).className,
    ).toContain('text-[16px]') // the show's own page: m-show sets the long show name at 16 px
    cleanup()

    await renderAt(
      '/shows/s1/settings',
      <AppShell
        showId="s1"
        crumbs={[{ label: 'More', link: { to: '/' }, backLabel: true }, { label: 'Settings' }]}
        account={account()}
      >
        <h1>Settings</h1>
      </AppShell>,
    )
    expect(screen.getByText('Settings', { selector: 'span.font-display' }).className).toContain(
      'text-[19px]',
    )
  })

  it('keeps sync state and the account menu until a screen draws its own phone controls into the bar', async () => {
    setWidth(390)
    await renderAt(
      '/shows/s1/docs/d1',
      <AppShell
        showId="s1"
        fullBleed
        crumbs={[
          { label: 'Shows', link: { to: '/' } },
          { label: 'Libretto', phoneLabel: 'Libretto v2' },
        ]}
        account={account()}
      >
        <h1>Script</h1>
      </AppShell>,
    )
    expect(screen.getByText('Libretto v2', { selector: 'span.font-display' })).toBeTruthy()
    // With nothing in the slot (loading, no versions, not found) the bar is the normal one.
    const slot = document.querySelector('[data-phone-slot]') as HTMLElement
    expect(slot.children).toHaveLength(0)
    const rest = slot.nextElementSibling as HTMLElement
    expect(rest.querySelector('button')).not.toBeNull()
    // Once something is in the slot, CSS hides them (the slot's content makes it :not(:empty)).
    expect(rest.className).toContain('group-has-[[data-phone-slot]:not(:empty)]/bar:hidden')
  })
})
