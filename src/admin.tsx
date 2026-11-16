import { FileUpload } from './file-upload'
import { pagePaths } from '../domain/navigation'
import { Icon } from './visuals'
import { nameKey, publicBaseTerms } from '../domain/terms'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Ingredient, Recipe } from '../domain/catalog'
import { TermPicker } from './term-picker'
import { Toast } from './toast'
import { quantityInUnit } from '../domain/units'

type ManagedAccount = { id: string; name: string; email: string; groupId: string; role: string; created: number | null; blocked: number; superuser: number; granted: number }
type ManagedGroup = { id: string; name: string; members: number; created: number | null; blocked: number }
type Publication = { id: string; title: string; groupName: string; status: 'pending' | 'approved' | 'rejected' | 'archived'; created: number }
type PendingTerm = { id: string; groupId: string; groupName: string; kind: 'ingredient' | 'tag'; name: string; unit?: string; code?: string; group?: string }
type IngredientCategory = { name: string; count: number }
export type Review = { recipe: Recipe; ingredients: Record<string, Ingredient> }
type Overview = { accounts: ManagedAccount[]; groups: ManagedGroup[]; publications: Publication[]; terms: PendingTerm[]; publicIngredients: Ingredient[]; categories: IngredientCategory[]; retiredIngredientIds: string[] }
const sections = {
  transfer: { title: 'Publieke recepten overzetten', description: 'Importeer of exporteer recepten via een JSON-bestand.' },
  publications: { title: 'Receptpublicaties', description: 'Beoordeel inzendingen en beheer gepubliceerde recepten.' },
  terms: { title: 'Ingrediënten en kenmerken', description: 'Bekijk nieuwe termen en maak ze publiek.' },
  categories: { title: 'Ingrediëntcategorieën', description: 'Beheer de categorieën op de boodschappenlijst.' },
  accounts: { title: 'Accounts', description: 'Beheer gebruikers en beheerrechten.' },
  emails: { title: 'Accountmails', description: 'Bewerk Nederlandse mailteksten en bekijk een voorbeeld.' },
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

export function AdminPage({ accountId, groupId, openRecipe, revision }: { revision: number; accountId: string; groupId: string; openRecipe: (review: Review, status: Publication["status"]) => void }) {
  const readSection = () => {
    const value = window.location.pathname.split('/')[2] || new URLSearchParams(window.location.search).get('section')
    return value && Object.hasOwn(sections, value) ? value as Section : undefined
  }
  const [section, setSection] = useState<Section | undefined>(readSection)
  useEffect(() => {
    const restore = () => setSection(readSection())
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  const heading = useRef<HTMLHeadingElement>(null)
  function navigate(next?: Section) {
    const url = new URL(window.location.href)
    url.pathname = pagePaths.beheer + (next ? '/' + next : '')
    url.searchParams.delete('page')
    url.searchParams.delete('section')
    window.history.pushState(null, '', url)
    setSection(next)
    setMessage('')
    setError('')
  }
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [section])
  const [accountSearch, setAccountSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [accountOrder, setAccountOrder] = useState('name')
  const [accountDescending, setAccountDescending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [groupSearch, setGroupSearch] = useState('')
  const [transferTab, setTransferTab] = useState<'export' | 'import'>('export')
  const transferId = useId()
  const [catalog, setCatalog] = useState<Recipe[]>([])
  const [bundle, setBundle] = useState<{ recipes: Recipe[] }>()
  const [exportIds, setExportIds] = useState<string[]>([])
  const [importIds, setImportIds] = useState<string[]>([])
  const toggle = (ids: string[], id: string) => ids.includes(id) ? ids.filter(key => key !== id) : [...ids, id]
  const [overview, setOverview] = useState<Overview>()
  const [recipeStatus, setRecipeStatus] = useState('')
  const [recipeSearch, setRecipeSearch] = useState('')
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function load() {
    const [next, response] = await Promise.all([adminRequest<Overview>('admin-overview'), fetch('/api/catalog')])
    if (!response.ok) throw new Error('De publieke catalogus kon niet worden geladen.')
    setCatalog((await response.json()).recipes)
    setOverview(next)
  }
  useEffect(() => { void load().catch(failure => setError(failure.message)) }, [revision])
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
  const visible = (overview?.publications ?? []).filter(item =>
    (!recipeStatus || item.status === recipeStatus) && item.title.toLocaleLowerCase('nl').includes(recipeSearch.trim().toLocaleLowerCase('nl')))
  const selection = visible.filter(item => selectedRecipes.includes(item.id))
  const actions = [
    { status: 'approved', label: 'Goedkeuren' }, { status: 'rejected', label: 'Afwijzen' },
    { status: 'archived', label: 'Verbergen' }, { status: 'restored', label: 'Opnieuw publiceren' },
    { status: 'deleted', label: 'Definitief verwijderen' },
  ]
  function allowed(item: Publication, status: string) {
    return status === 'deleted' || (item.status === 'pending' && ['approved', 'rejected'].includes(status)) ||
      (item.status === 'approved' && status === 'archived') || (item.status === 'archived' && status === 'restored')
  }
  function decide(ids: string[], status: string) {
    if (status === 'deleted' && !window.confirm('Definitief verwijderen? Deze recepten verdwijnen ook uit alle planningen waarin ze rechtstreeks zijn ingepland.')) return
    if (status === 'archived' && !window.confirm('Verbergen? Geplande maaltijden blijven staan. Opnieuw inplannen kan via een privékopie.')) return
    void change('publication-decide', { ids, status })
  }
  const pending = overview?.publications.filter(item => item.status === 'pending').length ?? 0
  const newTerms = overview?.terms?.length ?? 0
  const notifications: Partial<Record<Section, string>> = {
    publications: pending ? pending + ' te beoordelen' : undefined,
    terms: newTerms ? newTerms + (newTerms === 1 ? ' nieuwe term' : ' nieuwe termen') : undefined,
  }
  return <>
    {section && <button className="button admin-back" disabled={busy} onClick={() => navigate()}>← Terug naar dashboard</button>}
    <div className={'page-heading' + (section === 'accounts' ? ' accounts-heading' : '')}>
      <div className="eyebrow">Superuser{section && ' · Beheer'}</div>
      <h1 ref={heading} tabIndex={-1}>{section ? sections[section].title : 'Beheer'}</h1>
      {section !== 'accounts' && <p>{section ? sections[section].description : 'Beheer accounts, groepen en de openbare receptencatalogus.'}</p>}
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    <Toast message={message}/>
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
      <div className="transfer-tabs" role="tablist" aria-label="Recepten overzetten">
        {(['export', 'import'] as const).map(tab => <button key={tab} type="button" className={'button' + (transferTab === tab ? ' primary' : '')} role="tab" id={transferId + tab} aria-controls={transferId + tab + '-panel'} aria-selected={transferTab === tab} tabIndex={transferTab === tab ? 0 : -1} onClick={() => setTransferTab(tab)} onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault()
            const next = event.key === 'Home' ? 'export' : event.key === 'End' ? 'import' : transferTab === 'export' ? 'import' : 'export'
            setTransferTab(next)
            document.getElementById(transferId + next)?.focus()
          }
        }}>{tab === 'export' ? 'Exporteren' : 'Importeren'}</button>)}
      </div>
      <section className="transfer-section" role="tabpanel" id={transferId + 'export-panel'} aria-labelledby={transferId + 'export'} hidden={transferTab !== 'export'}>
      <button className="button" disabled={busy || !catalog.length} onClick={() => setExportIds(exportIds.length === catalog.length ? [] : catalog.map(item => item.id))}>{exportIds.length === catalog.length ? 'Alles deselecteren' : 'Alles selecteren'}</button>
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
      </section><section className="transfer-section" role="tabpanel" id={transferId + 'import-panel'} aria-labelledby={transferId + 'import'} hidden={transferTab !== 'import'}>
      <label>Catalogusbestand<FileUpload accept=".json,application/json" disabled={busy} onChange={event => {
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
      {bundle && <button className="button" disabled={busy} onClick={() => setImportIds(importIds.length === bundle.recipes.length ? [] : bundle.recipes.map(item => item.id))}>{importIds.length === bundle.recipes.length ? 'Alles deselecteren' : 'Alles selecteren'}</button>}
      {bundle?.recipes.map(recipe => <label className="check-row" key={recipe.id}>
        <input type="checkbox" checked={importIds.includes(recipe.id)} onChange={() => setImportIds(toggle(importIds, recipe.id))}/>{recipe.title}
      </label>)}
      <button className="button primary" disabled={busy || !importIds.length} onClick={() => void change('catalog-import', { bundle, ids: importIds })}>Importeer geselecteerde recepten</button></section>
    </section>
      <section className="panel recipe-management" hidden={section !== "publications"}>
        <div className="form-row">
          <label>Zoek op receptnaam<input value={recipeSearch} onChange={event => { setRecipeSearch(event.target.value); setSelectedRecipes([]) }}/></label>
          <label>Status<select value={recipeStatus} onChange={event => { setRecipeStatus(event.target.value); setSelectedRecipes([]) }}>
            <option value="">Alle statussen</option>
            {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        {!!selection.length && <div className="form-row admin-bulk">
          <strong className="admin-selection-count">{selection.length} geselecteerd</strong>
          {actions.filter(action => selection.every(item => allowed(item, action.status))).map(action =>
            <button className="button" key={action.status} disabled={busy} onClick={() => decide(selection.map(item => item.id), action.status)}>{action.label}</button>)}
        </div>}
        <div className="recipe-table-wrap"><table className="recipe-table">
          <thead><tr>
            <th><input type="checkbox" aria-label="Alle getoonde recepten selecteren" disabled={!visible.length || busy}
              checked={visible.length > 0 && selection.length === visible.length}
              onChange={event => setSelectedRecipes(event.target.checked ? visible.map(item => item.id) : [])}/></th>
            <th scope="col">Recept</th><th scope="col">Status</th><th scope="col">Acties</th>
          </tr></thead>
          <tbody>{visible.map(item => <tr key={item.id}>
            <td><input type="checkbox" aria-label={item.title + ' selecteren'} checked={selectedRecipes.includes(item.id)} disabled={busy}
              onChange={() => setSelectedRecipes(toggle(selectedRecipes, item.id))}/></td>
            <td><button className="button text" disabled={busy} onClick={() => void execute(async () => {
              openRecipe(await adminRequest<Review>('publication-review', { id: item.id }), item.status)
            })}>{item.title}</button><small>{item.created ? item.groupName + ' · ' + dateLabel(item.created) : 'Startrecept'}</small></td>
            <td>{statuses[item.status]}</td>
            <td><div className="form-row">{actions.filter(action => allowed(item, action.status)).map(action =>
              <button className={'button' + (action.status === 'deleted' ? ' danger' : '')} key={action.status} disabled={busy}
                onClick={() => decide([item.id], action.status)}>{action.label}</button>)}</div></td>
          </tr>)}</tbody>
        </table></div>
        {!visible.length && <p>Geen recepten gevonden.</p>}
      </section>
      {section === "emails" && <EmailManagement/>}
      <section className="panel people-panel" hidden={section !== "terms"}>

        {section === 'terms' && <TermManagement pending={overview?.terms ?? []} published={overview?.publicIngredients ?? []}
          categories={overview?.categories ?? []} retiredIds={overview?.retiredIngredientIds ?? []} openCategories={() => navigate('categories')}
          busy={busy} change={change}/>}
      </section>
      {section === 'categories' && <section className="panel people-panel"><div className="form-row"><button className="button" onClick={() => navigate('terms')}>Ingrediënten en kenmerken</button><button className="button primary" aria-pressed="true">Categorieën</button></div>
        <CategoryManagement categories={overview?.categories ?? []} busy={busy} change={change}/></section>}
      {section === 'accounts' && <div className="admin-account-actions"><p>{sections.accounts.description}</p><button className="button primary" onClick={() => { setError(''); setMessage(''); setInviteOpen(true) }}><Icon name="plus"/> Superuser uitnodigen</button></div>}
      {inviteOpen && section === 'accounts' && <dialog ref={node => { if (node && !node.open) node.showModal() }} aria-labelledby="invite-superuser-title" onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); if (!busy) setInviteOpen(false) }}>
        <div className="dialog-content"><div className="dialog-heading"><h2 id="invite-superuser-title">Superuser uitnodigen</h2><button className="icon-button" disabled={busy} aria-label="Sluiten" onClick={() => setInviteOpen(false)}><Icon name="close"/></button></div>
        <form className="invite-modal-form" onSubmit={event => form(event, 'invite-superuser')}>
          <label>E-mailadres van bestaand account<input type="email" name="email" required maxLength={254}/></label>
          <button className="button primary" disabled={busy}>Uitnodigen</button>
        </form>{error && <p className="alert" role="alert">{error}</p>}</div>
      </dialog>}
      <section className="panel people-panel accounts-panel" hidden={section !== "accounts"}>

        <div className="form-row">
          <label>Zoeken<input type="search" value={accountSearch} onChange={event => setAccountSearch(event.target.value)}/></label>
          <label>Filter<select value={accountFilter} onChange={event => setAccountFilter(event.target.value)}>
            <option value="">Alle accounts</option><option value="blocked">Geblokkeerd</option><option value="active">Actief</option><option value="superuser">Superusers</option><option value="owner">Eigenaren</option><option value="member">Leden</option>
          </select></label>
        </div>
        <div className="admin-table-scroll"><table className="admin-table"><thead><tr>{[['name', 'Naam'], ['email', 'E-mailadres'], ['group', 'Groep'], ['rights', 'Rechten'], ['status', 'Status'], ['created', 'Aangemaakt']].map(([key, label]) => <th key={key} aria-sort={accountOrder === key ? accountDescending ? 'descending' : 'ascending' : 'none'}><button className="table-sort" onClick={() => { setAccountDescending(accountOrder === key ? !accountDescending : false); setAccountOrder(key) }}>{label}<span aria-hidden="true">{accountOrder === key ? accountDescending ? '↓' : '↑' : '↕'}</span></button></th>)}<th>Acties</th></tr></thead><tbody>
        {overview?.accounts.filter(item => nameKey(item.name + ' ' + item.email + ' ' + overview.groups.find(group => group.id === item.groupId)?.name).includes(nameKey(accountSearch)))
          .filter(item => !accountFilter || (accountFilter === 'blocked' ? !!item.blocked : accountFilter === 'active' ? !item.blocked : accountFilter === 'superuser' ? !!item.superuser : item.role === accountFilter))
          .sort((a, b) => {
            const value = (item: ManagedAccount) => accountOrder === 'created' ? item.created ?? 0 : accountOrder === 'group' ? overview.groups.find(g => g.id === item.groupId)?.name ?? '' : accountOrder === 'rights' ? (item.superuser ? 'Superuser · ' : '') + (item.role === 'owner' ? 'Eigenaar' : 'Lid') : accountOrder === 'status' ? item.blocked ? 'Geblokkeerd' : 'Actief' : item[accountOrder as 'name' | 'email']
            const left = value(a), right = value(b)
            return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'nl')) * (accountDescending ? -1 : 1)
          })
          .map(item => <tr key={item.id}><td>{item.name}</td><td>{item.email}</td><td>{overview.groups.find(group => group.id === item.groupId)?.name}</td><td>{item.superuser ? 'Superuser · ' : ''}{item.role === 'owner' ? 'Eigenaar' : 'Lid'}</td><td>{item.blocked ? 'Geblokkeerd' : 'Actief'}</td><td>{dateLabel(item.created)}</td><td><div className="form-row">
          <button className="button" disabled={busy || item.id === accountId} onClick={() => void change('admin-block', { kind: 'account', id: item.id, blocked: !item.blocked })}>{item.blocked ? 'Deblokkeren' : 'Blokkeren'}</button>
          {!!item.granted && item.id !== accountId && <button className="button danger" disabled={busy}
            onClick={() => void change('admin-revoke', { id: item.id })}>Beheerrechten intrekken</button>}
        </div></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="panel people-panel" hidden={section !== "groups"}>

        <label>Groepen zoeken<input type="search" value={groupSearch} onChange={event => setGroupSearch(event.target.value)}/></label>
        {overview?.groups.filter(item => nameKey(item.name).includes(nameKey(groupSearch))).map(item => <article className="admin-row" key={item.id + item.name}>
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

type TermRow = { id: string; name: string; kind: 'ingredient' | 'tag'; groupId?: string; groupName?: string; unit?: string; code?: string; builtin?: boolean; group?: string }
type TermDraft = { name: string; code: string; group: string }

function TermManagement({ pending, published, categories, retiredIds, openCategories, busy, change }: {
  pending: PendingTerm[]; published: Ingredient[]; busy: boolean
  categories: IngredientCategory[]; retiredIds: string[]; openCategories: () => void
  change: (route: string, body: Record<string, unknown>) => Promise<void>
}) {
  const [scope, setScope] = useState<'pending' | 'public' | 'all'>(() => new URLSearchParams(window.location.search).get('scope') === 'all' ? 'all' : 'pending')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get('category') ?? undefined)
  const [bulkCategory, setBulkCategory] = useState('')
  const [withoutCode, setWithoutCode] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, TermDraft>>({})
  useEffect(() => { setDrafts({}) }, [pending, published])
  const [suggesting, setSuggesting] = useState(false)
  const [notice, setNotice] = useState('')
  const keyFor = (term: TermRow) => (term.groupId ?? '') + '/' + term.id
  const draftFor = (term: TermRow) => drafts[keyFor(term)] ?? { name: term.name, code: term.code ?? '', group: term.group ?? 'Overige ingrediënten' }
  const payload = (term: TermRow) => ({ id: term.id, groupId: term.groupId, kind: term.kind, ...draftFor(term) })
  const publicRows: TermRow[] = [
    ...publicBaseTerms.ingredients.filter(term => !published.some(item => item.id === term.id) && !retiredIds.includes(term.id))
      .map(term => ({ ...term, code: term.id, builtin: true, kind: 'ingredient' as const })),
    ...published.map(term => ({ ...term, builtin: publicBaseTerms.ingredients.some(item => item.id === term.id), kind: 'ingredient' as const })),
  ]
  const rows: TermRow[] = (scope === 'pending' ? pending : scope === 'public' ? publicRows : [...publicRows, ...pending]).filter(term =>
    (!withoutCode || (term.kind === 'ingredient' && !(term.code ?? '').trim())) &&
    (categoryFilter === undefined || (term.kind === 'ingredient' && (term.group ?? 'Overige ingrediënten') === categoryFilter)) &&
    [term.name, term.code ?? '', term.groupName ?? ''].some(value => nameKey(value).includes(nameKey(search))))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
  const pageSize = 20
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageNumbers = pageCount <= 8
    ? Array.from({ length: pageCount }, (_, index) => index)
    : [...new Set([0, 1, 2, 3, 4, currentPage, pageCount - 2, pageCount - 1])].sort((a, b) => a - b)

  function goToPage(next: number) {
    setPage(next)
    setSelected([])
  }

  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const selectable = visible
  const picked = selectable.filter(term => selected.includes(keyFor(term)))
  const allSelected = selectable.length > 0 && picked.length === selectable.length
  const locked = busy || suggesting
  const updateDraft = (term: TermRow, fields: Partial<TermDraft>) =>
    setDrafts(current => ({ ...current, [keyFor(term)]: { ...draftFor(term), ...fields } }))

  async function suggest(terms: TermRow[]) {
    setSuggesting(true)
    setNotice('')
    const reserved: string[] = []
    const failures: string[] = []
    for (const term of terms) {
      const name = draftFor(term).name
      try {
        const { code } = await adminRequest<{ code: string }>('ingredient-code-suggest', { name, id: term.id, reserved })
        reserved.push(code)
        updateDraft(term, { code })
      } catch { failures.push(name) }
    }
    setNotice(failures.length ? 'Geen voorstel voor ' + failures.join(', ') + '. Je kunt de code zelf invullen.' :
      reserved.length + (reserved.length === 1 ? ' code voorgesteld.' : ' codes voorgesteld.'))
    setSuggesting(false)
  }

  function switchScope(next: typeof scope) {
    setScope(next)
    setSearch('')
    setCategoryFilter(undefined)
    setWithoutCode(false)
    setPage(0)
    setSelected([])
    setNotice('')
  }
  return <>
    <div className="form-row">
      <button className={'button' + (scope === 'pending' ? ' primary' : '')} aria-pressed={scope === 'pending'} disabled={locked}
        onClick={() => switchScope('pending')}>Goed te keuren <span className="admin-badge">{pending.length}</span></button>
      <button className={'button' + (scope === 'public' ? ' primary' : '')} aria-pressed={scope === 'public'} disabled={locked}
        onClick={() => switchScope('public')}>Alle publieke ingrediënten</button>
      <button className="button" disabled={locked} onClick={openCategories}>Categorieën</button>
      {scope === 'all' && <button className="button primary" aria-pressed="true">Alle ingrediënten</button>}
    </div>
    <div className="form-row admin-bulk">
      <label>Zoeken<input type="search" value={search} disabled={locked} onChange={event => {
        setSearch(event.target.value)
        setPage(0)
        setSelected([])
      }}/></label>
      <label>Filter op categorie<select value={categoryFilter === undefined ? 'all' : 'category:' + categoryFilter} disabled={locked} onChange={event => {
        setCategoryFilter(event.target.value === 'all' ? undefined : event.target.value.slice(9))
        setPage(0)
        setSelected([])
      }}>
        <option value="all">Alle categorieën</option>
        {categories.map(category => <option key={category.name} value={'category:' + category.name}>{category.name}</option>)}
        <option value="category:">Niet op boodschappenlijst</option>
      </select></label>
      <label className="check-row"><input type="checkbox" checked={withoutCode} disabled={locked} onChange={event => {
        setWithoutCode(event.target.checked)
        setPage(0)
        setSelected([])
      }}/>Zonder code</label>
      {!!selectable.length && <label className="check-row"><input type="checkbox" checked={allSelected} disabled={locked}
        onChange={event => setSelected(event.target.checked ? selectable.map(keyFor) : [])}/>Selecteer deze pagina</label>}
    </div>
    {!!picked.length && <div className="form-row admin-bulk">
      <strong className="admin-selection-count">{picked.length} geselecteerd</strong>
      <button className="button primary" disabled={locked || !picked.some(term => term.kind === 'ingredient')}
        onClick={() => void change('ingredients-save', { ingredients: picked.filter(term => term.kind === 'ingredient').map(payload) })}>Selectie opslaan</button>
      <button className="button" disabled={locked || !picked.some(term => term.kind === 'ingredient')}
        onClick={() => void suggest(picked.filter(term => term.kind === 'ingredient'))}>Engelse codes voorstellen</button>
      {scope === 'pending' && <button className="button primary" disabled={locked}
        onClick={() => void change('terms-publish', { terms: picked.map(payload) })}>Selectie publiek maken</button>}
    </div>}
    {!!picked.some(term => term.kind === 'ingredient') && <div className="form-row admin-bulk category-bulk">
      <label>Categorie voor selectie<select value={bulkCategory} disabled={locked} onChange={event => setBulkCategory(event.target.value)}>
        <option value="">Kies een categorie…</option>
        {categories.map(category => <option key={category.name}>{category.name}</option>)}
      </select></label>
      <button className="button" disabled={locked || !bulkCategory} onClick={() => void change('ingredients-category', {
        ingredients: picked.filter(term => term.kind === 'ingredient').map(term => ({ id: term.id, groupId: term.groupId })), group: bulkCategory,
      })}>Categorie toewijzen</button>
    </div>}
    {suggesting && <p role="status">Engelse codes ophalen…</p>}
    <Toast message={notice}/>
    {!visible.length && <div className="term-empty" role="status">
      <span className="term-empty-icon"><Icon name={search.trim() || categoryFilter !== undefined || withoutCode ? 'search' : 'check'}/></span>
      <strong>{search.trim() || categoryFilter !== undefined || withoutCode ? 'Geen resultaten gevonden' : scope === 'pending' ? 'Alles bijgewerkt' : 'Nog geen publieke ingrediënten'}</strong>
      {search.trim() || categoryFilter !== undefined || withoutCode ? <button className="button" disabled={locked} onClick={() => {
        setSearch('')
        setCategoryFilter(undefined)
        setWithoutCode(false)
        goToPage(0)
      }}>Wis filters</button>
        : scope === 'pending' && <p>Er wachten geen ingrediënten of kenmerken op goedkeuring.</p>}
    </div>}
    {visible.map(term => {
      const key = keyFor(term)
      const draft = draftFor(term)
      return <article className="admin-row term-admin-row" key={key}>
        <input type="checkbox" aria-label={term.name + ' selecteren'} checked={selected.includes(key)} disabled={locked}
          onChange={event => setSelected(current => event.target.checked ? [...current, key] : current.filter(id => id !== key))}/>
        <div>
          <small>{term.builtin ? 'Standaard' : term.groupName ?? 'Publiek'} · {term.unit ?? 'Kenmerk'}</small>
          <form className="form-row term-admin-fields" onSubmit={event => {
            event.preventDefault()
            const publish = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'publish'
            void change(publish ? 'term-publish' : 'ingredient-edit', payload(term))
          }}>
            <label>Naam<input required maxLength={term.kind === 'tag' ? 40 : 80} value={draft.name}
              disabled={locked} onChange={event => updateDraft(term, { name: event.target.value })}/></label>
            {term.kind === 'ingredient' && <label>Code<input maxLength={64} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.code}
              disabled={locked} onChange={event => updateDraft(term, { code: event.target.value })}/></label>}
            {term.kind === 'ingredient' && <label className="ingredient-category-field">Categorie<select value={draft.group} disabled={locked} onChange={event => updateDraft(term, { group: event.target.value })}>
              {draft.group === '' && <option value="">Niet op boodschappenlijst</option>}
              {categories.map(category => <option key={category.name} value={category.name}>{category.name}</option>)}
            </select></label>}
            {term.kind === 'ingredient' && <>
              <button type="button" className="icon-button" title="Engelse code voorstellen" aria-label={'Engelse code voorstellen voor ' + term.name}
                disabled={locked} onClick={() => void suggest([term])}><Icon name="generate"/></button>
              <button className="button" disabled={locked}>Opslaan</button>
            </>}
            {term.groupId && <button className="button" value="publish" disabled={locked}>Publiek maken</button>}
          </form>
          {term.kind === 'ingredient' && <IngredientMerge source={term} busy={locked} change={change}
            options={[...publicRows, ...pending.filter(item => item.kind === 'ingredient' && item.groupId === term.groupId && !publicRows.some(publicTerm => publicTerm.id === item.id))]
              .filter(item => item.id !== term.id)}/>}
        </div>
      </article>
    })}
    {pageCount > 1 && <div className="term-pagination" role="navigation" aria-label="Pagina’s ingrediënten en kenmerken">
      <button className="icon-button" aria-label="Vorige pagina" disabled={locked || !currentPage} onClick={() => goToPage(currentPage - 1)}><Icon name="left"/></button>
      {pageNumbers.map((number, index) => <span className="term-page" key={number}>
        {index > 0 && number > pageNumbers[index - 1] + 1 && <span aria-hidden="true">…</span>}
        <button className={'button' + (number === currentPage ? ' primary' : '')}
          aria-label={'Pagina ' + (number + 1)} aria-current={number === currentPage ? 'page' : undefined}
          disabled={locked} onClick={() => { if (number !== currentPage) goToPage(number) }}>{number + 1}</button>
      </span>)}
      <button className="icon-button" aria-label="Volgende pagina" disabled={locked || currentPage + 1 === pageCount} onClick={() => goToPage(currentPage + 1)}><Icon name="right"/></button>
    </div>}
  </>
}

function IngredientMerge({ source, options, busy, change }: { source: TermRow; options: TermRow[]; busy: boolean; change: (route: string, body: Record<string, unknown>) => Promise<void> }) {
  const [target, setTarget] = useState<TermRow>()
  const ratio = target && source.unit && target.unit ? quantityInUnit(1, source.unit, target.unit) : undefined
  return <details className="ingredient-merge">
    <summary>Controleer soortgelijk ingrediënt</summary>
    <div className="ingredient-merge-content">
      <p>Is dit hetzelfde ingrediënt onder een andere naam? Zoek het bestaande ingrediënt om {source.name} daarmee te vervangen.</p>
      <TermPicker label="Bestaand ingrediënt zoeken" options={options} maxLength={80} disabled={busy}
        describe={item => `${item.unit} · ${item.groupId ? item.groupName : 'Publiek'}`}
        pick={setTarget}/>
      {target && <>
        <div className="ingredient-merge-preview"><strong>{source.name} → {target.name}</strong><p>{ratio === undefined
          ? `De eenheden ${source.unit} en ${target.unit} zijn niet automatisch omrekenbaar. Kies een ander ingrediënt.`
          : `1 ${source.unit} wordt ${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 6 }).format(ratio)} ${target.unit}${target.unit?.endsWith('.') ? '' : '.'} Recepten, stappen en vertalingen worden bijgewerkt. Bestaande hoeveelheden worden opgeteld.`}</p>
          <small>{source.groupId ? `Geldt voor privérecepten en inzendingen van ${source.groupName}.` : 'Geldt voor alle huishoudens en publieke recepten.'} Controleer na samenvoegen de afvinkstatus op je boodschappenlijst.</small></div>
        <button type="button" className="button" disabled={busy || ratio === undefined} onClick={() => {
          if (!window.confirm(`${source.name} vervangen door ${target.name}? Het oorspronkelijke ingrediënt verdwijnt en alle bijbehorende receptverwijzingen worden bijgewerkt. Dit kan niet via deze pagina worden teruggedraaid.`)) return
          void change('ingredient-merge', { id: source.id, groupId: source.groupId, targetId: target.id })
        }}>Vervang door {target.name}</button>
      </>}
    </div>
  </details>
}

function CategoryManagement({ categories, busy, change }: { categories: IngredientCategory[]; busy: boolean; change: (route: string, body: Record<string, unknown>) => Promise<void> }) {
  return <div className="category-management">
    <form className="form-row" onSubmit={event => {
      event.preventDefault()
      const form = event.currentTarget
      const name = String(new FormData(form).get('name'))
      void change('category-save', { name })
    }}><label>Nieuwe categorie<input name="name" required maxLength={80} disabled={busy}/></label><button className="button primary" disabled={busy}><Icon name="plus"/> Categorie toevoegen</button></form>
    <p className="category-help">Kies bij ieder ingrediënt een categorie. Hernoemen werkt meteen door op de boodschappenlijsten. Bij verwijderen verplaats je de ingrediënten naar een andere categorie.</p>
    {categories.map(category => <CategoryRow key={category.name} category={category} categories={categories} busy={busy} change={change}/>)}
  </div>
}

function CategoryRow({ category, categories, busy, change }: { category: IngredientCategory; categories: IngredientCategory[]; busy: boolean; change: (route: string, body: Record<string, unknown>) => Promise<void> }) {
  const [name, setName] = useState(category.name)
  const [replacement, setReplacement] = useState('Overige ingrediënten')
  const protectedCategory = category.name === 'Overige ingrediënten'
  return <article className="category-row">
    <form className="form-row" onSubmit={event => { event.preventDefault(); void change('category-save', { name, previous: category.name }) }}>
      <label>Categorienaam<span className="category-name-group"><input aria-label={'Naam van categorie ' + category.name} value={name} maxLength={80} required disabled={busy || protectedCategory} onChange={event => setName(event.target.value)}/>
        <a className="button category-count" aria-label={`${category.count} ingrediënten in ${category.name} bekijken`} href={'/admin/terms?' + new URLSearchParams({ scope: 'all', category: category.name })}>{category.count}</a>
      </span></label>
      {!protectedCategory && <button className="button" disabled={busy || name === category.name}>Opslaan</button>}
    </form>
    {!protectedCategory ? <details className="category-remove"><summary>Categorie verwijderen</summary>
      <form className="form-row" onSubmit={event => {
        event.preventDefault()
        if (!window.confirm(`${category.name} verwijderen en de ingrediënten verplaatsen naar ${replacement}?`)) return
        void change('category-delete', { name: category.name, replacement })
      }}><label>Ingrediënten verplaatsen naar<select value={replacement} disabled={busy} onChange={event => setReplacement(event.target.value)}>
        {categories.filter(item => item.name !== category.name).map(item => <option key={item.name}>{item.name}</option>)}
      </select></label><button className="button danger" disabled={busy}>Verplaatsen en verwijderen</button></form>
    </details> : <small>Vaste opvangcategorie voor ingrediënten zonder categorie.</small>}
  </article>
}


type EmailTemplate = { kind: string; name: string; subject: string; heading: string; body: string; button: string; footer: string }
function EmailManagement() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [kind, setKind] = useState('register')
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html')
  const previewId = useId()
  const [preview, setPreview] = useState<{ subject: string; html: string; text: string }>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const requestVersion = useRef(0)
  const draft = templates.find(item => item.kind === kind)
  useEffect(() => {
    let active = true
    void adminRequest<{ templates: EmailTemplate[] }>('email-templates').then(result => {
      if (active) setTemplates(result.templates)
    }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [])
  function update(field: keyof EmailTemplate, value: string) {
    requestVersion.current++
    setTemplates(current => current.map(item => item.kind === kind ? { ...item, [field]: value } : item))
    setPreview(undefined)
    setMessage('')
  }
  async function run(action: 'save' | 'preview') {
    const version = ++requestVersion.current
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (action === 'save') {
        await adminRequest('email-template-save', { kind, template: draft })
        if (version === requestVersion.current) setMessage('Opgeslagen. Nieuwe mails gebruiken deze teksten.')
      } else {
        const result = await adminRequest<{ subject: string; html: string; text: string }>('email-template-preview', { kind, template: draft })
        if (version === requestVersion.current) setPreview(result)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'De aanvraag is mislukt.')
    } finally { setBusy(false) }
  }
  return <section className="panel email-management">
    <label>Accountmail<select value={kind} disabled={busy} onChange={event => {
      requestVersion.current++
      setKind(event.target.value)
      setPreview(undefined)
      setMessage('')
      setError('')
    }}>{templates.map(item => <option key={item.kind} value={item.kind}>{item.name}</option>)}</select></label>
    {error && <p className="alert" role="alert">{error}</p>}
    {draft && <form className="email-template-form" onSubmit={event => { event.preventDefault(); void run('save') }}>
      <p className="fine-print">Je kunt {'{naam}'}, {'{groep}'} en {'{geldigheid}'} gebruiken. De actieknop en herstel-link worden automatisch toegevoegd.</p>
      <fieldset disabled={busy}>
        <legend>Nederlandse teksten</legend>
        <label>Onderwerp<input required maxLength={200} value={draft.subject} onChange={event => update('subject', event.target.value)}/></label>
        <label>Titel<input required maxLength={160} value={draft.heading} onChange={event => update('heading', event.target.value)}/></label>
        <label>Bericht<textarea required maxLength={4000} rows={7} value={draft.body} onChange={event => update('body', event.target.value)}/></label>
        <label>Tekst op de knop<input required maxLength={80} value={draft.button} onChange={event => update('button', event.target.value)}/></label>
        <label>Voettekst<textarea required maxLength={800} rows={3} value={draft.footer} onChange={event => update('footer', event.target.value)}/></label>
      </fieldset>
      <div className="form-row">
        <button className="button primary" disabled={busy}>Teksten opslaan</button>
        <button type="button" className="button" disabled={busy} onClick={() => void run('preview')}>Voorbeeld bekijken</button>
      </div>
    </form>}
    <Toast message={message}/>
    {preview && <section className="email-preview">
      <h2>Voorbeeld</h2>
      <p className="email-preview-subject">Onderwerp: <strong>{preview.subject}</strong></p>
      <div className="email-preview-frame">
        <div className="email-preview-tabs" role="tablist" aria-label="Voorbeeldweergave">
          {(['html', 'text'] as const).map(mode => <button key={mode} type="button" role="tab"
            id={previewId + '-' + mode} aria-selected={previewMode === mode} aria-controls={previewId + '-panel'}
            tabIndex={previewMode === mode ? 0 : -1}
            onClick={() => setPreviewMode(mode)}
            onKeyDown={event => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const next = event.key === 'Home' ? 'html' : event.key === 'End' ? 'text' : mode === 'html' ? 'text' : 'html'
                setPreviewMode(next)
                document.getElementById(previewId + '-' + next)?.focus()
              }
            }}>{mode === 'html' ? 'HTML' : 'Text'}</button>)}
        </div>
        <div id={previewId + '-panel'} role="tabpanel" aria-labelledby={previewId + '-' + previewMode} tabIndex={0}>
          {previewMode === 'html' ? <iframe title="Voorbeeld accountmail" sandbox="" srcDoc={preview.html}/> : <pre>{preview.text}</pre>}
        </div>
      </div>
    </section>}
  </section>
}
