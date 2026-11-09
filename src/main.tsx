import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ingredientById, recipes as starterRecipes } from '../domain/catalog'
import type { Recipe } from '../domain/catalog'
import { addDays, amount, datesFrom, diners, formatDate, householdRecipes, portions, shoppingItems, today, weekStart } from '../domain/planning'
import type { Action, Person, State } from '../domain/planning'
import { Icon, Plate } from './visuals'
import { RecipeEditor } from './recipe-editor'
import { useMealDrag } from './meal-drag'
import './style.css'

declare const __BUILD_TIMESTAMP__: string | null

type Snapshot = { state: State; revision: number }
type Tab = 'planning' | 'recepten' | 'boodschappen' | 'huisgenoten'
type Modal = { kind: 'recipe'; id: string; date?: string } | { kind: 'day'; date: string } | { kind: 'edit'; recipe: Recipe; date?: string; isNew?: boolean }
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'planning', label: 'Weekplanning', icon: 'calendar' },
  { id: 'recepten', label: 'Recepten', icon: 'book' },
  { id: 'boodschappen', label: 'Boodschappen', icon: 'basket' },
  { id: 'huisgenoten', label: 'Huisgenoten', icon: 'people' },
]
const formatShort = (date: string) => formatDate(date, { day: 'numeric', month: 'short' })
const formatLong = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

function useHousehold() {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  async function request(path = '/api/state', body?: string) {
    const response = await fetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    if (!response.ok) throw new Error((await response.json()).error)
    const result: Snapshot = await response.json()
    setSnapshot(current => !current || result.revision >= current.revision ? result : current)
  }
  useEffect(() => {
    const refresh = () => {
      if (!active.current) void request().catch(() => setError('De server is niet bereikbaar.'))
    }
    refresh()
    const interval = window.setInterval(refresh, 4000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh) }
  }, [])
  async function write(path: string, body: string) {
    if (active.current) return false
    active.current = true
    setBusy(true)
    setError('')
    try {
      await request(path, body)
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.')
      return false
    } finally {
      setBusy(false)
      active.current = false
    }
  }
  return {
    state: snapshot?.state, busy, error, setError,
    save: (action: Action) => write('/api/state', JSON.stringify(action)),
    restore: (body: string) => write('/api/backup', body),
  }
}

function Dialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-content">
      <div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Sluiten" onClick={close}><Icon name="close"/></button></div>
      {children}
    </div>
  </dialog>
}

function Settings({ busy, error, restore, clearDatabase, close }: {
  busy: boolean; error: string; restore: (body: string) => Promise<boolean>; clearDatabase: () => Promise<boolean>; close: () => void
}) {
  const [file, setFile] = useState<File>()
  const [confirmed, setConfirmed] = useState(false)
  const [message, setMessage] = useState('')
  const [reading, setReading] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const pending = busy || reading
  const fileInput = useRef<HTMLInputElement>(null)

  return <Dialog title="Instellingen" close={() => { if (!pending) close() }}>
    {__BUILD_TIMESTAMP__ && <p>Laatste update · <time dateTime={__BUILD_TIMESTAMP__}>
      {new Intl.DateTimeFormat('nl-NL', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Amsterdam',
      }).format(new Date(__BUILD_TIMESTAMP__))}
    </time></p>}
    <h3>Database exporteren</h3>
    <p>Download een JSON-back-up van je recepten, planning, huisgenoten en boodschappen.</p>
    <a className="button backup-link" href="/api/backup" download>Download back-up</a>
    <h3>Database importeren</h3>
    <p>Een back-up terugzetten vervangt alle huidige gegevens.</p>
    <form className="backup-form" onSubmit={async event => {
      event.preventDefault()
      if (!file || !confirmed || pending) return
      setMessage('')
      if (file.size > 10 * 1024 * 1024) {
        setMessage('Kies een bestand van maximaal 10 MB.')
        return
      }
      setReading(true)
      try {
        if (await restore(await file.text())) {
          setFile(undefined)
          setConfirmed(false)
          if (fileInput.current) fileInput.current.value = ''
          setMessage('Back-up teruggezet.')
        }
      } catch {
        setMessage('Het bestand kon niet worden gelezen.')
      } finally {
        setReading(false)
      }
    }}>
      <label>Back-upbestand<input ref={fileInput} type="file" accept=".json,application/json" required disabled={pending}
        onChange={event => {
          setFile(event.target.files?.[0])
          setConfirmed(false)
          setMessage('')
        }}/></label>
      {file && <label className="check-row"><input type="checkbox" checked={confirmed} disabled={pending}
        onChange={event => setConfirmed(event.target.checked)}/><span>Vervang de huidige gegevens door deze back-up</span></label>}
      <button className="button primary" disabled={!file || !confirmed || pending}>{pending ? 'Bezig met terugzetten…' : 'Back-up terugzetten'}</button>
    </form>
    <h3>Database legen</h3>
    {!confirmClear
      ? <button className="button danger" disabled={pending} onClick={() => { setMessage(''); setConfirmClear(true) }}>Database legen</button>
      : <div>
        <p className="alert" role="alert">Dit wist alle recepten, geplande maaltijden, huisgenoten en boodschappen. Terugzetten kan alleen met een back-up.</p>
        <div className="form-row">
          <button className="button danger" disabled={pending} onClick={async () => {
            if (await clearDatabase()) {
              setConfirmClear(false)
              setMessage('Database geleegd.')
            }
          }}>Ja, wis alle gegevens</button>
          <button className="button" disabled={pending} onClick={() => setConfirmClear(false)}>Annuleren</button>
        </div>
      </div>}
    {error && <p className="alert" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </Dialog>
}

function RecipeDetail({ recipe, date, state, save, close, busy, edit }: {
  recipe: Recipe; date?: string; state: State; save: (action: Action) => Promise<boolean>; close: () => void; busy: boolean; edit: () => void
}) {
  const [scale, setScale] = useState(date ? portions(diners(state, date)) : 1)
  const [target, setTarget] = useState(date && date >= today() ? date : today())
  const [confirmedRecipe, setConfirmedRecipe] = useState<string>()
  const existing = state.meals.find(meal => meal.date === target)
  const replaces = existing && existing.recipeId !== recipe.id
  const confirm = replaces && existing.recipeId === confirmedRecipe
  const describe = (id: string, fraction = 1) => {
    const item = ingredientById[id]
    return amount(recipe.amounts[id] * scale * fraction, item.unit) + ' ' + item.name.toLocaleLowerCase('nl')
  }
  async function plan(event: FormEvent) {
    event.preventDefault()
    if (replaces && !confirm) { setConfirmedRecipe(existing.recipeId); return }
    if (await save({ type: 'meal', date: target, recipeId: recipe.id })) close()
  }
  return <>
    <div className={'detail-art ' + recipe.theme}><Plate theme={recipe.theme}/></div>
    <div className="detail-tools"><p className="recipe-meta"><Icon name="clock" size={16}/> {recipe.minutes} min <span>·</span> {recipe.cuisine}</p><button className="button" onClick={edit}><Icon name="edit" size={16}/> Recept aanpassen</button></div>
    <p>{recipe.description}</p>
    <div className="tags">{recipe.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
    <div className="portion-bar">
      <div><strong>Hoeveelheden</strong><small>{date ? 'Start met de porties van de mee-eters' : 'Het basisrecept is voor één persoon'}</small></div>
      <label className="inline-field"><input type="number" min="0" max="200" step="0.25" aria-label="Aantal porties" value={scale} onChange={event => {
        const value = event.target.valueAsNumber
        if (Number.isFinite(value) && value >= 0 && value <= 200) setScale(value)
      }}/> porties</label>
    </div>
    <h3>Ingrediënten</h3>
    <ul className="ingredients">{Object.entries(recipe.amounts).map(([id, base]) => <li key={id}><span>{ingredientById[id].name}</span><strong>{amount(base * scale, ingredientById[id].unit)}</strong></li>)}</ul>
    <h3>Stap voor stap</h3>
    <ol className="steps">{recipe.steps.map((step, index) => <li key={index}>{step.split(/(\{[^}]+\})/g).map((part, i) => {
      if (!part.startsWith('{')) return part
      const [id, factor] = part.slice(1, -1).split(':')
      return <strong key={i}>{describe(id, factor ? Number(factor) : 1)}</strong>
    })}</li>)}</ol>
    <form className="form-row dialog-footer" onSubmit={plan}>
      <label>Inplannen op<input type="date" value={target} min={today()} required onChange={event => { setTarget(event.target.value); setConfirmedRecipe(undefined) }}/></label>
      <button className="button primary" disabled={busy}>{confirm ? 'Maaltijd vervangen' : 'Plan dit recept'} <Icon name="calendar" size={17}/></button>
      {confirm && <small className="full-width">Op die dag staat al {householdRecipes(state)[existing.recipeId].title}.</small>}
    </form>
  </>
}

function RecipeCards({ recipes, onOpen, filters = false }: { recipes: Recipe[]; onOpen: (recipe: Recipe) => void; filters?: boolean }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const tagOptions = [...new Set(recipes.flatMap(recipe => [...recipe.tags, recipe.cuisine]))].sort((a, b) => a.localeCompare(b, 'nl'))
  const active = selected.filter(tag => tagOptions.includes(tag))
  const visible = recipes.filter(recipe => recipe.title.toLocaleLowerCase('nl').includes(search.trim().toLocaleLowerCase('nl')) &&
    active.every(tag => recipe.cuisine === tag || recipe.tags.includes(tag)))
  return <>
    {filters && <div className="filters">
      <label className="search"><Icon name="search"/><input aria-label="Zoek op receptnaam" placeholder="Zoek op receptnaam…" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <button className={'icon-button filter-button' + (active.length ? ' filter-active' : '')} aria-label={active.length ? 'Filter op kenmerken, ' + active.length + ' actief' : 'Filter op kenmerken'} onClick={() => setFilterOpen(true)}>
        <Icon name="filter"/>{active.length > 0 && <span aria-hidden="true">{active.length}</span>}
      </button>
    </div>}
    {filterOpen && <Dialog title="Filter op kenmerken" close={() => setFilterOpen(false)}>
      <p>Toon recepten die aan alle geselecteerde kenmerken voldoen.</p>
      <div className="filter-options">{tagOptions.map(tag => <label className="check-row" key={tag}>
        <input type="checkbox" checked={active.includes(tag)} onChange={event => setSelected(event.target.checked ? [...active, tag] : active.filter(item => item !== tag))}/>
        <span>{tag}</span>
      </label>)}</div>
      <div className="form-row dialog-footer"><button className="button primary" onClick={() => setFilterOpen(false)}>Toon {visible.length} {visible.length === 1 ? 'recept' : 'recepten'}</button>
        <button className="button" disabled={!active.length} onClick={() => setSelected([])}>Wis filters</button></div>
    </Dialog>}
    <div className="recipe-grid">
      {visible.map(recipe => <button key={recipe.id} className="recipe-card" onClick={() => onOpen(recipe)}>
        <div className={'recipe-art ' + recipe.theme}><Plate theme={recipe.theme}/><span className="time-pill"><Icon name="clock" size={14}/>{recipe.minutes} min</span></div>
        <div className="recipe-body"><small>{recipe.cuisine}</small><h3>{recipe.title}</h3><p>{recipe.subtitle}</p><div className="tags"><>{recipe.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</><Icon name="arrow" size={18}/></div></div>
      </button>)}
    </div>
    {!visible.length && <p className="empty">Geen recepten gevonden.</p>}
  </>
}

function PersonForm({ person, save, busy }: {
  person?: Person; save: (action: Action) => Promise<boolean>; busy: boolean
}) {
  const [name, setName] = useState(person?.name ?? '')
  const [factor, setFactor] = useState(String(person?.factor ?? 1))
  const [removing, setRemoving] = useState(false)
  return <form className="form-row person-form" onSubmit={async event => {
    event.preventDefault()
    if (await save({ type: 'person', id: person?.id ?? newId(), name, factor: Number(factor) }) && !person) {
      setName('')
      setFactor('1')
    }
  }}>
    <label>Naam<input value={name} maxLength={40} required placeholder="Naam huisgenoot" onChange={event => setName(event.target.value)}/></label>
    <label>Portiefactor<input type="number" value={factor} min={0.25} max={4} step={0.25} required onChange={event => setFactor(event.target.value)}/></label>
    <button className={'button ' + (person ? '' : 'primary')} disabled={busy}>{person ? 'Opslaan' : 'Toevoegen'}</button>
    {person && <button type="button" className="button text danger" disabled={busy} onClick={() => {
      if (removing) void save({ type: 'removePerson', id: person.id })
      else setRemoving(true)
    }}>{removing ? 'Bevestig verwijderen' : 'Verwijderen'}</button>}
  </form>
}

function ShoppingExport({ items, extras, close }: {
  items: ReturnType<typeof shoppingItems>; extras: State['extras']; close: () => void
}) {
  const [options, setOptions] = useState({ 'Opsommingstekens': true, 'Categorieën': true, 'Hoeveelheden': true, 'Dagen': false })
  const [copyStatus, setCopyStatus] = useState('')
  const rows = [
    ...items.map(item => ({
      group: item.group,
      text: item.name + (options.Hoeveelheden ? ' — ' + amount(item.total, item.unit) : '') +
        (options.Dagen ? ' (nodig op ' + item.uses.map(([date]) => formatShort(date)).join(', ') + ')' : ''),
    })),
    ...extras.map(item => ({ group: 'Losse boodschappen', text: item.name })),
  ]
  const line = (row: (typeof rows)[number]) => (options.Opsommingstekens ? '• ' : '') + row.text
  const groups = [...new Set(items.map(item => item.group))].sort((a, b) => a.localeCompare(b, 'nl'))
  if (extras.length) groups.push('Losse boodschappen')
  const output = groups.flatMap(group => [
    ...(options.Categorieën ? [group] : []),
    ...rows.filter(row => row.group === group).map(line),
    ...(options.Categorieën ? [''] : []),
  ]).join('\n').trimEnd()
  return <Dialog title="Boodschappen als tekst" close={close}>
    <div className="export-options">{(Object.keys(options) as (keyof typeof options)[]).map(option =>
      <label className="check-row" key={option}><input type="checkbox" checked={options[option]} onChange={event => {
        setOptions({ ...options, [option]: event.target.checked })
        setCopyStatus('')
      }}/><span>{option}</span></label>)}</div>
    <label>Tekstvoorbeeld<textarea readOnly rows={12} value={output}/></label>
    <div className="form-row dialog-footer">
      <button className="button primary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(output)
          setCopyStatus('Tekst gekopieerd.')
        } catch {
          setCopyStatus('Selecteer de tekst om die handmatig te kopiëren.')
        }
      }}><Icon name="copy" size={16}/> Kopieer tekst</button>
      <small role="status">{copyStatus}</small>
    </div>
  </Dialog>
}

function Shopping({ state, save, busy }: { state: State; save: (action: Action) => Promise<boolean>; busy: boolean }) {
  const [start, setStart] = useState(today)
  const [days, setDays] = useState(3)
  const [extra, setExtra] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const items = shoppingItems(state, start, days)
  const total = items.length + state.extras.length
  const checked = items.filter(item => item.checked).length + state.extras.filter(item => item.checked).length
  return <>
    <div className="page-heading"><div className="eyebrow"><Icon name="basket" size={16}/> Naar de winkel</div><h1>Boodschappen</h1><p>Alle ingrediënten van je geplande maaltijden op één lijst.</p></div>
    <div className="panel shop-controls">
      <div className="form-row">
        <label>Ik doe boodschappen op<input type="date" value={start} onChange={event => { if (event.target.value) setStart(event.target.value) }}/></label>
        <label>Voor hoeveel dagen?<select value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 14].map(n => <option key={n} value={n}>{n} {n === 1 ? 'dag' : 'dagen'}</option>)}</select></label>
      </div>
      <div className="progress"><strong>{checked} van {total} afgevinkt</strong><progress max={total || 1} value={checked}/>
        {checked > 0 && <button className="remove-checked" disabled={busy}
          onClick={() => void save({ type: 'removeChecked', start, days })}>Verwijder afgevinkte items</button>}
      </div>
    </div>
    <div className="shopping-grid">
      {[...new Set(items.map(item => item.group))].sort((a, b) => a.localeCompare(b, 'nl')).map(group => <section className="panel shop-group" key={group}>
        <h2>{group}</h2>
        {items.filter(item => item.group === group).map(item => {
          const shelfDays = item.shelfDays
          const later = shelfDays === undefined ? [] : item.uses.filter(([date]) => date >= addDays(start, shelfDays))
          const laterAmount = later.reduce((total, [, quantity]) => total + quantity, 0)
          return <label className={'check-row ' + (item.checked ? 'done' : '')} key={item.key}>
            <input type="checkbox" checked={item.checked} disabled={busy} onChange={event => void save({ type: 'check', key: item.key, checked: event.target.checked, start, days })}/>
            <span>{item.name}<small>{later.length ? amount(laterAmount, item.unit) + ' later kopen voor ' + later.map(([date]) => formatShort(date)).join(', ') : 'Nodig op ' + item.uses.map(([date]) => formatShort(date)).join(', ')}</small></span>
            <strong>{amount(item.total, item.unit)}</strong>
          </label>
        })}
      </section>)}
      <section className="panel shop-group">
        <h2>Losse boodschappen</h2>
        <form className="form-row add-extra" onSubmit={async event => {
          event.preventDefault()
          if (await save({ type: 'extra', id: newId(), name: extra })) setExtra('')
        }}>
          <input aria-label="Losse boodschap" placeholder="Bijv. koffie of keukenpapier" required maxLength={100} value={extra} onChange={event => setExtra(event.target.value)}/>
          <button className="button primary" disabled={busy} aria-label="Losse boodschap toevoegen"><Icon name="plus"/></button>
        </form>
        {state.extras.map(item => <div className="extra" key={item.id}>
          <label className={'check-row ' + (item.checked ? 'done' : '')}><input type="checkbox" checked={item.checked} disabled={busy} onChange={event => void save({ type: 'checkExtra', id: item.id, checked: event.target.checked })}/><span>{item.name}</span></label>
          <button className="icon-button" aria-label={item.name + ' verwijderen'} disabled={busy} onClick={() => void save({ type: 'removeExtra', id: item.id })}><Icon name="close" size={16}/></button>
        </div>)}
      </section>
    </div>
    <div className="export-line"><button className="button" disabled={!total} onClick={() => setExportOpen(true)}><Icon name="copy" size={16}/> Exporteer als tekst</button></div>
    {exportOpen && <ShoppingExport items={items} extras={state.extras} close={() => setExportOpen(false)}/>}
    {!items.length && <p className="empty">Voor deze dagen staan er geen ingrediënten op de boodschappenlijst.</p>}
    <p className="fine-print">Houdbaarheid is een planningsindicatie. Controleer de verpakking en bewaarvoorschriften.</p>
  </>
}

function App() {
  const { state, save, restore, error, setError, busy } = useHousehold()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('planning')
  const [week, setWeek] = useState(() => weekStart(today()))
  const [modal, setModal] = useState<Modal>()
  const [notice, setNotice] = useState('')
  const catalog = state ? householdRecipes(state) : {}
  const recipes = Object.values(catalog)
  const suggestions = starterRecipes.filter(recipe => Object.hasOwn(catalog, recipe.id)).map(recipe => catalog[recipe.id])
  const selectedRecipe = modal?.kind === 'recipe' ? catalog[modal.id] : undefined
  const dayMeal = modal?.kind === 'day' ? state?.meals.find(meal => meal.date === modal.date) : undefined
  async function moveMeal(from: string, to: string) {
    const recipeId = state?.meals.find(meal => meal.date === from)?.recipeId
    if (!recipeId) return
    if (await save({ type: 'moveMeal', from, to, recipeId })) {
      setWeek(weekStart(to))
      setNotice('Maaltijd verplaatst naar ' + formatLong(to) + '.')
      close()
    }
  }
  const { drag, handlers } = useMealDrag((from, to) => void moveMeal(from, to))
  const current = today()
  const days = datesFrom(week, 7)
  const planned = state?.meals.filter(meal => days.includes(meal.date)).length ?? 0
  const navigate = (id: Tab) => { setTab(id); setNotice(''); window.scrollTo(0, 0) }
  const openRecipe = (recipe: Recipe, date?: string) => setModal({ kind: 'recipe', id: recipe.id, date })
  const close = () => { setError(''); setModal(undefined) }
  const openDay = (date: string) => setModal({ kind: 'day', date })
  const newRecipe = () => setModal({ kind: 'edit', isNew: true, recipe: {
    id: newId(), title: '', subtitle: '', cuisine: '', description: '', minutes: 30, tags: [], theme: 'green', amounts: {}, steps: [''],
  } })

  return <>
    <header className="site-header"><div className="header-inner">
      <button className="wordmark" onClick={() => navigate('planning')}><span className="brand-icon"><Icon name="leaf" size={23}/></span>Aan tafel<span className="brand-dot">.</span></button>
      <nav aria-label="Hoofdnavigatie">{tabs.map(item => <button key={item.id} className={tab === item.id ? 'nav-current' : ''}
        aria-current={tab === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
    </div></header>
    <main>
      {error && <div className="alert" role="alert">{error}<button className="icon-button" aria-label="Melding sluiten" onClick={() => setError('')}><Icon name="close"/></button></div>}
      {!state && <p className="empty" role="status">{error ? 'Wachten op de server…' : 'Je weekmenu laden…'}</p>}
      {state && tab === 'planning' && <>
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><Icon name="leaf" size={16}/> Samen aan tafel</div>
            <h1>Wat eten we<br/>deze week?</h1>
            <p>Plan je avondeten, houd bij wie er mee-eet en neem je boodschappenlijst mee naar de winkel.</p>
            <button className="button hero-button" onClick={() => navigate('boodschappen')}><Icon name="basket"/> Naar boodschappen <Icon name="arrow" size={17}/></button>
          </div>
          <Plate theme="green" hero/>
        </section>
        <section className="schedule" aria-labelledby="week-title">
          <div className="section-heading">
            <div><h2 id="week-title">Weekplanning</h2><p>{planned} {planned === 1 ? 'maaltijd gepland' : 'maaltijden gepland'}</p></div>
            <div className="week-controls">
              <button className="icon-button" aria-label="Vorige week" onClick={() => { setWeek(addDays(week, -7)); setNotice('') }}><Icon name="left"/></button>
              <button className="week-range" title="Terug naar deze week" onClick={() => { setWeek(weekStart(current)); setNotice('') }}>{formatShort(week)} – {formatShort(days[6])}</button>
              <button className="icon-button" aria-label="Volgende week" onClick={() => { setWeek(addDays(week, 7)); setNotice('') }}><Icon name="right"/></button>
            </div>
          </div>
          <div className="panel day-list">{days.map(date => {
            const meal = state.meals.find(item => item.date === date)
            const recipe = meal && catalog[meal.recipeId]
            const guests = diners(state, date)
            const dropClass = drag?.from === date ? ' drag-source' : drag?.to === date ? (meal ? ' drop-blocked' : ' drop-ready') : ''
            return <div className={'day-row ' + (date === current ? 'is-today' : '') + dropClass} data-meal-date={date} key={date} aria-current={date === current ? 'date' : undefined}>
              <div className="day-date"><span>{formatDate(date, { weekday: 'short' }).replace('.', '')}</span><strong>{formatDate(date, { day: 'numeric' })}</strong></div>
              {recipe ? <button className="meal-title" disabled={busy} {...handlers(date, () => openRecipe(recipe, date))}><span className={'meal-dot ' + recipe.theme}/><span><strong>{recipe.title}</strong><small>{recipe.minutes} min · {recipe.cuisine}</small></span></button>
                : <button className="add-meal" onClick={() => openDay(date)}><Icon name="plus" size={17}/> Maaltijd plannen</button>}
              {date === current && <span className="today-pill">Vandaag</span>}
              <button className="guests" onClick={() => openDay(date)} aria-label={'Mee-eters op ' + formatLong(date)}><Icon name="people" size={17}/><span>{guests.length} <span className="guest-label">mee</span></span></button>
              <button className="icon-button day-more" aria-label={'Bewerk ' + formatLong(date)} onClick={() => openDay(date)}><Icon name="dots" size={18}/></button>
            </div>
          })}</div>
          <p className="fine-print">Houd een maaltijd even ingedrukt en sleep naar een vrije dag.</p>
          <div className="copy-line">
            <button className="button" disabled={!planned || busy} onClick={async () => {
              if (await save({ type: 'copyWeek', from: week })) {
                setWeek(addDays(week, 7))
                setNotice('De maaltijden zijn naar vrije dagen in de volgende week gekopieerd.')
              }
            }}><Icon name="copy" size={16}/> Kopieer naar volgende week</button>
            <span role="status">{notice}</span>
          </div>
        </section>
        {suggestions.length > 0 && <section className="suggestions"><div className="section-heading"><div><h2>Voor deze week</h2><p>Ideeën voor je volgende avondmaaltijd.</p></div>
          <button className="button text" onClick={() => navigate('recepten')}>Alle recepten <Icon name="arrow" size={17}/></button>
        </div><RecipeCards recipes={suggestions} onOpen={openRecipe}/></section>}
      </>}
      {state && tab === 'recepten' && <>
        <div className="page-heading"><div className="eyebrow"><Icon name="book" size={16}/> Het receptenboek</div><h1>Recepten</h1><p>Vind en filter recepten, voeg je eigen gerechten toe of pas een recept aan.</p><button className="button primary new-recipe" onClick={newRecipe}><Icon name="plus" size={17}/> Recept toevoegen</button></div>
        <RecipeCards recipes={recipes} onOpen={openRecipe} filters/>
        <p className="fine-print">Kies glutenvrije verpakkingen waar nodig, ook bij linzen en kruidenmixen. <a href="https://www.voedingscentrum.nl/encyclopedie/gluten-en-het-glutenvrij-dieet.aspx" target="_blank" rel="noreferrer">Voedingscentrum</a></p>
      </>}
      {state && tab === 'boodschappen' && <Shopping state={state} save={save} busy={busy}/>}
      {state && tab === 'huisgenoten' && <>
        <div className="page-heading"><div className="eyebrow"><Icon name="people" size={16}/> {state.household.name}</div><h1>Huisgenoten</h1><p>Beheer wie er mee-eet. Portiefactor 1 is één standaardportie.</p></div>
        <section className="panel people-panel"><h2>Jouw huishouden</h2>{state.people.map(person => <PersonForm key={person.id + person.name + person.factor} person={person} save={save} busy={busy}/>)}
          {!state.people.length && <p>Voeg hieronder je eerste huisgenoot toe.</p>}
          <h3>Huisgenoot toevoegen</h3><PersonForm save={save} busy={busy}/>
        </section>
      </>}
    </main>
    <footer className="site-footer">
      <span className="footer-brand"><Icon name="leaf" size={16}/> Aan tafel · Jouw weekmenu</span>
      <button className="button text" disabled={!state} onClick={() => { setError(''); setSettingsOpen(true) }}>
        <Icon name="settings" size={17}/> Instellingen
      </button>
    </footer>
    {settingsOpen && <Settings busy={busy} error={error} restore={restore} clearDatabase={() => save({ type: 'clearDatabase' })} close={() => { setError(''); setSettingsOpen(false) }}/>}
    {state && modal && <Dialog key={modal.kind} title={modal.kind === 'recipe' ? selectedRecipe?.title ?? 'Recept' : modal.kind === 'edit' ? (modal.isNew ? 'Recept toevoegen' : 'Recept aanpassen') : formatLong(modal.date)} close={close}>
      {error && <p className="alert" role="alert">{error}</p>}
      {modal.kind === 'recipe' && selectedRecipe && <RecipeDetail recipe={selectedRecipe} date={modal.date} state={state} save={save} close={close} busy={busy}
        edit={() => setModal({ kind: 'edit', recipe: selectedRecipe, date: modal.date })}/>}
      {modal.kind === 'edit' && <RecipeEditor recipe={modal.recipe} busy={busy} cancel={() => {
        setError('')
        if (modal.isNew) close()
        else openRecipe(modal.recipe, modal.date)
      }} onSave={async recipe => {
        if (await save({ type: 'saveRecipe', recipe })) openRecipe(recipe, modal.date)
      }}/>}
      {modal.kind === 'day' && <>
        <h3>Mee-eters</h3>
        <p>Iedereen eet standaard mee. Vink uit wie er die dag niet is.</p>
        <div className="attendance">{state.people.map(person => <label key={person.id} className="check-row">
          <input type="checkbox" checked={diners(state, modal.date).some(item => item.id === person.id)} disabled={busy}
            onChange={event => void save({ type: 'attendance', date: modal.date, id: person.id, present: event.target.checked })}/>
          <span>{person.name}</span><strong>{amount(person.factor, 'portie')}</strong>
        </label>)}</div>
        {!state.people.length && <button className="button" onClick={() => { close(); navigate('huisgenoten') }}>Huisgenoot toevoegen</button>}
        <h3>Avondeten</h3>
        <label>Recept<select disabled={busy} value={state.meals.find(meal => meal.date === modal.date)?.recipeId ?? ''}
          onChange={event => void save({ type: 'meal', date: modal.date, recipeId: event.target.value || null })}>
          <option value="">Geen maaltijd gepland</option>{recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.title}</option>)}
        </select></label>
        {dayMeal && <form className="form-row dialog-footer" onSubmit={event => {
          event.preventDefault()
          const destination = String(new FormData(event.currentTarget).get('destination') || '')
          if (destination === modal.date) setError('Kies een andere dag.')
          else void moveMeal(modal.date, destination)
        }}>
          <label>Verplaatsen naar<input type="date" name="destination" required/></label>
          <button className="button" disabled={busy}>Maaltijd verplaatsen</button>
        </form>}
        <div className="dialog-footer"><button className="button primary" onClick={close}>Klaar <Icon name="check" size={17}/></button></div>
      </>}
    </Dialog>}
  </>
}

createRoot(document.getElementById('root')!).render(<App/>)
