import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ingredientAmount } from '../domain/planning'
import type { Ingredient, Recipe } from '../domain/catalog'

type ManagedAccount = { id: string; name: string; email: string; groupId: string; role: string; created: number | null; blocked: number; superuser: number; granted: number }
type ManagedGroup = { id: string; name: string; members: number; created: number | null; blocked: number }
type Publication = { id: string; title: string; groupName: string; status: 'pending' | 'approved' | 'rejected' | 'archived'; created: number }
type PendingTerm = { id: string; groupId: string; groupName: string; kind: 'ingredient' | 'tag'; name: string; unit?: string }
type Review = { recipe: Recipe; ingredients: Record<string, Ingredient> }
type Overview = { accounts: ManagedAccount[]; groups: ManagedGroup[]; publications: Publication[]; terms: PendingTerm[] }
const sections = {
  transfer: { title: 'Publieke recepten overzetten', description: 'Importeer of exporteer recepten via een JSON-bestand.' },
  publications: { title: 'Receptpublicaties', description: 'Beoordeel inzendingen en beheer gepubliceerde recepten.' },
  terms: { title: 'Ingrediënten en kenmerken', description: 'Bekijk nieuwe termen en maak ze publiek.' },
  accounts: { title: 'Accounts', description: 'Beheer gebruikers en beheerrechten.' },
  groups: { title: 'Groepen', description: 'Bekijk en beheer huishoudens.' },
}
type Section = keyof typeof sections

const statuses = { pending: 'Te beoordelen', approved: 'Publiek', rejected: 'Afgewezen', archived: 'Verborgen' }
const dateLabel = (value: number | null) => value ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' }).format(value) : 'datum onbekend'

async function adminRequest<T>(route: string, body: Record<string, unknown> = {}) {
  const response = await fetch('/api/auth/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error)
  return result as T
}

export function AdminPage({ accountId, groupId }: { accountId: string; groupId: string }) {
  const [section, setSection] = useState<Section>()
  const heading = useRef<HTMLHeadingElement>(null)
  function navigate(next?: Section) {
    setSection(next)
    setMessage('')
    setError('')
  }
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [section])
  const [catalog, setCatalog] = useState<Recipe[]>([])
  const [bundle, setBundle] = useState<{ recipes: Recipe[] }>()
  const [exportIds, setExportIds] = useState<string[]>([])
  const [importIds, setImportIds] = useState<string[]>([])
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(key => key !== id) : [...ids, id]
  const [overview, setOverview] = useState<Overview>()
  const [preview, setReview] = useState<Review>()
  const review = preview?.recipe
  const ingredients = preview?.ingredients ?? {}
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function load() {
    const [next, response] = await Promise.all([adminRequest<Overview>('admin-overview'), fetch('/api/catalog')])
    if (!response.ok) throw new Error('De publieke catalogus kon niet worden geladen.')
    setCatalog((await response.json()).recipes)
    setOverview(next)
  }
  useEffect(() => { void load().catch(failure => setError(failure.message)) }, [])
  async function execute(work: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await work() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'De actie is niet gelukt.') }
    finally { setBusy(false) }
  }
  function change(route: string, body: Record<string, unknown>) {
    return execute(async () => {
      const result = await adminRequest<{ message: string }>(route, body)
      await load()
      setMessage(result.message)
    })
  }
  function form(event: FormEvent<HTMLFormElement>, route: string, extras: Record<string, unknown> = {}) {
    event.preventDefault()
    void change(route, { ...Object.fromEntries(new FormData(event.currentTarget)), ...extras })
  }
  const pending = overview?.publications.filter(item => item.status === 'pending').length ?? 0
  const newTerms = overview?.terms?.length ?? 0
  const notifications: Partial<Record<Section, string>> = {
    publications: pending ? pending + ' te beoordelen' : undefined,
    terms: newTerms ? newTerms + (newTerms === 1 ? ' nieuwe term' : ' nieuwe termen') : undefined,
  }
  return <>
    {section && <button className="button admin-back" disabled={busy} onClick={() => navigate()}>← Terug naar dashboard</button>}
    <div className="page-heading">
      <div className="eyebrow">Superuser{section && ' · Beheer'}</div>
      <h1 ref={heading} tabIndex={-1}>{section ? sections[section].title : 'Beheer'}</h1>
      <p>{section ? sections[section].description : 'Beheer accounts, groepen en de openbare receptencatalogus.'}</p>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!section && <div className="admin-dashboard">
      {(Object.keys(sections) as Section[]).map(key => <button className="panel admin-tile" key={key} onClick={() => navigate(key)}>
        <span className="admin-tile-heading">
          <strong>{sections[key].title}</strong>
          {notifications[key] && <span className="admin-badge">{notifications[key]}</span>}
        </span>
        <span>{sections[key].description}</span>
      </button>)}
    </div>}
    <section className="panel people-panel" hidden={section !== "transfer"}>

      <p>Verplaats geselecteerde recepten met hun ingrediënten en kenmerken via een JSON-bestand. Bestaande recepten met hetzelfde ID worden overgeslagen.</p>
      <h3>Exporteren</h3>
      {catalog.map(recipe => <label className="check-row" key={recipe.id}>
        <input type="checkbox" checked={exportIds.includes(recipe.id)} onChange={() => setExportIds(toggle(exportIds, recipe.id))}/>{recipe.title}
      </label>)}
      <button className="button" disabled={busy || !exportIds.length} onClick={() => void execute(async () => {
        const data = await adminRequest('catalog-export', { ids: exportIds })
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url
        link.download = 'aan-tafel-publieke-recepten.json'
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })}>Download geselecteerde recepten</button>
      <h3>Importeren</h3>
      <label>Catalogusbestand<input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
        const file = event.target.files?.[0]
        setBundle(undefined)
        setImportIds([])
        if (!file) return
        void execute(async () => {
          if (file.size > 10 * 1024 * 1024) throw new Error('Het catalogusbestand is te groot (max. 10 MB).')
          const data = JSON.parse(await file.text())
          if (data?.format !== 'aan-tafel-public-catalog' || data.version !== 1 || !Array.isArray(data.recipes) ||
            !data.recipes.every((recipe: Recipe) => typeof recipe?.id === 'string' && typeof recipe?.title === 'string') ||
            new Set(data.recipes.map((recipe: Recipe) => recipe.id)).size !== data.recipes.length) {
            throw new Error('Kies een geldig catalogusbestand.')
          }
          setBundle(data)
        })
      }}/></label>
      {bundle?.recipes.map(recipe => <label className="check-row" key={recipe.id}>
        <input type="checkbox" checked={importIds.includes(recipe.id)} onChange={() => setImportIds(toggle(importIds, recipe.id))}/>{recipe.title}
      </label>)}
      <button className="button primary" disabled={busy || !importIds.length} onClick={() => void change('catalog-import', { bundle, ids: importIds })}>Importeer geselecteerde recepten</button>
    </section>
      <section className="panel people-panel" hidden={section !== "publications"}>

        {!overview?.publications.length && <p>Geen publicaties.</p>}
        {overview?.publications.map(item => <article className="admin-row" key={item.id}>
          <strong>{item.title}</strong><p>{item.groupName} · {statuses[item.status]} · {dateLabel(item.created)}</p>
          <button className="button" disabled={busy} onClick={() => void execute(async () => {
            if (review?.id === item.id) setReview(undefined)
            else setReview(await adminRequest<Review>('publication-review', { id: item.id }))
          })}>{review?.id === item.id ? 'Voorbeeld sluiten' : 'Recept bekijken'}</button>
          {review?.id === item.id && <div className="admin-review">
            {review.image && <img className="recipe-upload-preview" src={review.image} alt="Receptafbeelding"/>}
            <p>{review.subtitle} · {review.cuisine} · {review.minutes} min</p>
            <p>{review.description}</p>
            {review.source === null && <p>Origineel recept</p>}
            {review.source && <p>Bron: <a href={review.source} target="_blank" rel="noreferrer">{review.source}</a></p>}<p>{review.tags.join(' · ')}</p>
            <ul>{Object.entries(review.amounts).map(([id, value]) => <li key={id}>{ingredientAmount(value, ingredients[id].unit)} {ingredients[id].name}</li>)}</ul>
            <ol>{review.steps.map((step, index) => <li key={index}>{step.replace(/\{([^}:]+)(?::([^}]+))?\}/g, (_, id: string, fraction: string | undefined) =>
              ingredientAmount(review.amounts[id] * Number(fraction ?? 1), ingredients[id].unit) + ' ' + ingredients[id].name.toLocaleLowerCase('nl'))}</li>)}</ol>
            {item.status === 'pending' && <div className="form-row">
              <button className="button primary" disabled={busy} onClick={() => void change('publication-decide', { id: item.id, status: 'approved' })}>Goedkeuren</button>
              <button className="button danger" disabled={busy} onClick={() => void change('publication-decide', { id: item.id, status: 'rejected' })}>Afwijzen</button>
            </div>}
            {item.status === 'approved' && <button className="button danger" disabled={busy} onClick={() => void change('publication-decide', { id: item.id, status: 'archived' })}>Verbergen</button>}
          </div>}
        </article>)}
      </section>
      <section className="panel people-panel" hidden={section !== "terms"}>

        <p>Pas desgewenst de publieke naam aan. Publiceer de gekoppelde termen voordat je een recept goedkeurt.</p>
        {!overview?.terms?.length && <p>Geen nieuwe termen om te publiceren.</p>}
        {overview?.terms?.map(term => <article className="admin-row" key={term.groupId + '/' + term.id}>

          <p>{term.kind === 'ingredient' ? 'Ingrediënt' : 'Kenmerk'} · {term.groupName}</p>
          <form className="form-row" onSubmit={event => form(event, 'term-publish', { groupId: term.groupId, id: term.id, kind: term.kind })}>
            <label>Publieke naam<input name="name" defaultValue={term.name} required maxLength={term.kind === 'ingredient' ? 80 : 40}/></label>
            {term.unit && <small>Eenheid: {term.unit}</small>}
            <button className="button" disabled={busy}>Publiek maken</button>
          </form>
        </article>)}
      </section>
      <section className="panel people-panel" hidden={section !== "accounts"}>

        {overview?.accounts.map(item => <article className="admin-row" key={item.id}>
          <strong>{item.name}{item.superuser ? ' · Superuser' : ''}</strong>
          <p>{item.email} · {overview.groups.find(group => group.id === item.groupId)?.name} · {item.role === 'owner' ? 'Eigenaar' : 'Lid'} · {dateLabel(item.created)}</p>
          <button className="button" disabled={busy || item.id === accountId} onClick={() => void change('admin-block', { kind: 'account', id: item.id, blocked: !item.blocked })}>{item.blocked ? 'Deblokkeren' : 'Blokkeren'}</button>
          {!!item.granted && item.id !== accountId && <button className="button danger" disabled={busy}
            onClick={() => void change('admin-revoke', { id: item.id })}>Beheerrechten intrekken</button>}
        </article>)}
        <h3>Superuser uitnodigen</h3>
        <form className="form-row" onSubmit={event => form(event, 'invite-superuser')}>
          <label>E-mailadres van bestaand account<input type="email" name="email" required maxLength={254}/></label>
          <button className="button primary" disabled={busy}>Uitnodigen</button>
        </form>
      </section>
      <section className="panel people-panel" hidden={section !== "groups"}>

        {overview?.groups.map(item => <article className="admin-row" key={item.id + item.name}>
          <p>{item.members} gekoppelde accounts · {dateLabel(item.created)}</p>
          <form className="form-row" onSubmit={event => form(event, 'admin-rename', { id: item.id })}>
            <label>Groepsnaam<input name="name" defaultValue={item.name} required maxLength={80}/></label>
            <button className="button" disabled={busy}>Opslaan</button>
          </form>
          <button className="button" disabled={busy || item.id === groupId} onClick={() => void change('admin-block', { kind: 'group', id: item.id, blocked: !item.blocked })}>{item.blocked ? 'Groep deblokkeren' : 'Groep blokkeren'}</button>
        </article>)}
      </section>
  </>
}
