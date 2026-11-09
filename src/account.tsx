import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Person } from '../domain/planning'
import { Icon } from './visuals'

export type Account = { id: string; email: string; name: string; role: 'owner' | 'member'; groupId: string; personId: string }
type Screen = 'login' | 'register' | 'forgot' | 'accept' | 'reset'
const titles: Record<Screen, string> = {
  login: 'Inloggen', register: 'Aanmelden', forgot: 'Wachtwoord vergeten',
  accept: 'Account activeren', reset: 'Nieuw wachtwoord kiezen',
}

export async function authRequest(route: string, data: Record<string, string> = {}) {
  const response = await fetch('/api/auth/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result as { message?: string }
}

function mailLink(): { action: 'accept' | 'reset'; token: string } | undefined {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const action = hash.get('action')
  const token = hash.get('token')
  return token && (action === 'accept' || action === 'reset') ? { action, token } : undefined
}
export const hasAccountLink = () => !!mailLink()

export function AccountScreen({ refresh, signedIn }: { refresh: () => Promise<void>; signedIn: boolean }) {
  const [link, setLink] = useState(mailLink)
  const [screen, setScreen] = useState<Screen>(link?.action ?? 'login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  function show(next: Screen) {
    if (link) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setLink(undefined)
    }
    setScreen(next)
    setError('')
    setMessage('')
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    if (link) data.token = link.token
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await authRequest(screen, data)
      if (screen === 'login' || screen === 'accept' || screen === 'reset') {
        show('login')
        await refresh()
      }
      setMessage(result.message ?? '')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Probeer het opnieuw.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="account-page">
    <section className="panel account-panel">
      <div className="eyebrow"><Icon name="leaf" size={18}/> Aan tafel</div>
      <h1>{titles[screen]}</h1>
      {screen === 'register' && <p>Maak je eigen groep aan. Je krijgt een link om je e-mailadres te bevestigen en een wachtwoord te kiezen.</p>}
      {screen === 'forgot' && <p>Vraag een link aan om een nieuw wachtwoord te kiezen.</p>}
      {screen === 'accept' && <p>Rond je aanmelding of uitnodiging af met een wachtwoord.</p>}
      <form key={screen} onSubmit={submit}>
        {(screen === 'register' || screen === 'accept') && <label>{screen === 'accept' ? 'Naam (als je als nieuwe huisgenoot aansluit)' : 'Naam'}<input name="name" autoComplete="name" maxLength={40} required={screen === 'register'}/></label>}
        {screen === 'register' && <label>Groepsnaam<input name="group" required maxLength={80}/></label>}
        {['register', 'login', 'forgot'].includes(screen) && <label>E-mailadres<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>}
        {['login', 'accept', 'reset'].includes(screen) && <label>Wachtwoord<input name="password" type="password" required minLength={12} maxLength={128}
          autoComplete={screen === 'login' ? 'current-password' : 'new-password'}/></label>}
        <button className="button primary" disabled={busy}>{busy ? 'Even geduld…' : screen === 'forgot' ? 'Stuur herstellink' : titles[screen]}</button>
      </form>
      {error && <p className="alert" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="account-links">
        {screen === 'login' ? <>
          <button className="button text" onClick={() => show('register')}>Aanmelden</button>
          <button className="button text" onClick={() => show('forgot')}>Wachtwoord vergeten?</button>
        </> : <button className="button text" onClick={async () => {
          show('login')
          if (signedIn) await refresh()
        }}>{signedIn ? 'Terug naar mijn groep' : 'Terug naar inloggen'}</button>}
      </div>
    </section>
  </main>
}

export function InviteForm({ people }: { people: Person[] }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  return <form className="invite-form" onSubmit={async event => {
    event.preventDefault()
    const form = event.currentTarget
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const result = await authRequest('invite', data)
      setMessage(result.message ?? '')
      form.reset()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Uitnodigen is niet gelukt.')
    } finally {
      setBusy(false)
    }
  }}>
    <div className="form-row">
      <label>E-mailadres<input type="email" name="email" required maxLength={254}/></label>
      <label>Koppelen aan<select name="personId"><option value="">Nieuwe huisgenoot</option>
        {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <button className="button primary" disabled={busy}>Uitnodiging versturen</button>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </form>
}
