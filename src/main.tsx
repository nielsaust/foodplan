import { TermPicker } from './term-picker'
import { nameKey } from '../domain/terms'
import { emptyTerms, publicBaseTerms } from '../domain/terms'
import type { Terms } from '../domain/terms'
import type { UnitSystem } from '../domain/units'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { recipes as starterRecipes, dietTags, nutritionLabels, allergyTags, isAllergyTag } from '../domain/catalog'
import type { Ingredient, Recipe } from '../domain/catalog'
import { addDays, amount, ingredientAmount, householdIngredients, datesFrom, diners, formatDate, householdRecipes, portions, shoppingItems, today, weekStart } from '../domain/planning'
import type { Action, Person, State } from '../domain/planning'
import { Icon, Plate } from './visuals'
import { AccountScreen, InviteForm, authRequest, hasAccountLink } from './account'
import type { Account } from './account'
import { AdminPage } from './admin'
import { nutrition } from '../domain/nutrition'
import { RecipeEditor } from './recipe-editor'
import { useMealDrag } from './meal-drag'
import './style.css'

declare const __BUILD_TIMESTAMP__: string | null

type Snapshot = { state: State; revision: number }
type Tab = 'planning' | 'recepten' | 'boodschappen' | 'huisgenoten' | 'beheer'
type Modal = { kind: 'recipe'; id: string; date?: string; publicRecipe?: Recipe } | { kind: 'day'; date: string } | { kind: 'edit'; recipe: Recipe; date?: string; isNew?: boolean; publicEdit?: boolean }
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'planning', label: 'Weekplanning', icon: 'calendar' },
  { id: 'recepten', label: 'Recepten', icon: 'book' },
  { id: 'boodschappen', label: 'Boodschappen', icon: 'basket' },
  { id: 'huisgenoten', label: 'Huisgenoten', icon: 'people' },
]
const formatShort = (date: string) => formatDate(date, { day: 'numeric', month: 'short' })
const formatLong = (date: string) => formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

function useHousehold(onExpired: () => void) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const active = useRef(false)
  async function request(path = '/api/state', body?: string) {
    const response = await fetch(path, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })
    if (response.status === 401) onExpired()
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

function Dialog({ title, children, close, printable, fullscreen }: { title: string; children: ReactNode; close: () => void; printable?: boolean; fullscreen?: boolean }) {
  const titleId = useId()
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className={printable ? "recipe-print-dialog mobile-fullscreen" : fullscreen ? "mobile-fullscreen" : undefined} ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-content">
      <div className="dialog-heading"><h2 id={titleId}>{title}</h2><div className="dialog-heading-actions">
        {printable && <button type="button" className="icon-button" aria-label="Afdrukken of opslaan als PDF" title="Print / PDF" onClick={() => window.print()}><Icon name="printer"/></button>}
        <button type="button" className="icon-button" aria-label="Sluiten" onClick={close}><Icon name="close"/></button>
      </div></div>
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

function RecipeArt({ recipe }: { recipe: Recipe }) {
  return recipe.image ? <img className="recipe-photo" src={recipe.image} alt="" loading="lazy"/> : <Plate theme={recipe.theme}/>
}

function Nutrition({ recipe }: { recipe: Recipe }) {
  const values = recipe.nutrition ?? nutrition(recipe)
  if (!values) return null
  const parts = Object.entries(values).map(([key, value]) => value.toLocaleString('nl-NL') + ' ' + nutritionLabels[key as keyof typeof nutritionLabels])
  return parts.length ? <small className="nutrition">{recipe.nutrition ? '' : 'Ca. '}{parts.join(' · ')} per portie</small> : null
}

function RecipeDetail({ recipe, date, state, save, close, busy, edit, copy, publish, remove, canPlan, ingredients, unitSystem }: {
  recipe: Recipe; date?: string; state: State; save: (action: Action) => Promise<boolean>; close: () => void; busy: boolean; edit?: () => void; copy?: () => void; publish?: () => Promise<void>; remove?: () => Promise<void>; canPlan: boolean; ingredients: Record<string, Ingredient>; unitSystem: UnitSystem
}) {
  const [publicationMessage, setPublicationMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [scale, setScale] = useState(date ? portions(diners(state, date)) : 1)
  const planningDays = datesFrom(today(), 7)
  const [target, setTarget] = useState(date && planningDays.includes(date) ? date : planningDays[0])
  const [confirmedRecipe, setConfirmedRecipe] = useState<string>()
  const existing = state.meals.find(meal => meal.date === target)
  const replaces = existing && existing.recipeId !== recipe.id
  const confirm = replaces && existing.recipeId === confirmedRecipe
  const describe = (id: string, fraction = 1) => {
    const item = ingredients[id]
    return ingredientAmount(recipe.amounts[id] * scale, item.unit, unitSystem, fraction) + ' ' + item.name.toLocaleLowerCase('nl')
  }
  async function plan(event: FormEvent) {
    event.preventDefault()
    if (replaces && !confirm) { setConfirmedRecipe(existing.recipeId); return }
    if (await save({ type: 'meal', date: target, recipeId: recipe.id })) close()
  }
  return <>
    <div className={'detail-art ' + recipe.theme}><RecipeArt recipe={recipe}/></div>
    {(edit || remove || copy) && <div className="detail-tools">{edit && <button className="button" onClick={edit}><Icon name="edit" size={16}/> Recept aanpassen</button>}
    {remove && <button className="button danger" disabled={busy} onClick={() => {
      if (window.confirm('Recept verwijderen? Het verdwijnt ook uit de weekplanning. De ingrediënten blijven bewaard.')) void remove()
    }}>Recept verwijderen</button>}
      {copy && <button className="button" disabled={busy} onClick={copy}><Icon name="copy" size={16}/> Bewaar als privérecept</button>}
    </div>}
    <p className="recipe-meta"><Icon name="clock" size={16}/> {recipe.minutes} min <span>·</span> {recipe.cuisine}</p>
    <Nutrition recipe={recipe}/>
    <p>{recipe.description}</p>
    {recipe.source === null && <p className="fine-print">Origineel recept</p>}
    {recipe.source && <p className="fine-print">Bron: <a href={recipe.source} target="_blank" rel="noreferrer">{new URL(recipe.source).hostname}</a></p>}
    <div className="tags">{recipe.tags.map(tag => <span className={isAllergyTag(tag) ? "allergy-tag" : undefined} key={tag}>{tag}</span>)}</div>
    <div className="portion-bar">
      <div><strong>Hoeveelheden</strong><small>{date ? 'Start met de porties van de mee-eters' : 'Het basisrecept is voor één persoon'}</small></div>
      <label className="inline-field"><input type="number" min="0" max="200" step="0.25" aria-label="Aantal porties" value={scale} onChange={event => {
        const value = event.target.valueAsNumber
        if (Number.isFinite(value) && value >= 0 && value <= 200) setScale(value)
      }}/> porties</label>
    </div>
    <p className="print-portions">Voor {amount(scale, scale === 1 ? "portie" : "porties")}</p>
    <h3>Ingrediënten</h3>
    <ul className="ingredients">{Object.entries(recipe.amounts).map(([id, base]) => <li key={id}><span>{ingredients[id].name}</span><strong>{ingredientAmount(base * scale, ingredients[id].unit, unitSystem)}</strong></li>)}</ul>
    <h3>Stap voor stap</h3>
    <ol className="steps">{recipe.steps.map((step, index) => <li key={index}>{step.split(/(\{[^}]+\})/g).map((part, i) => {
      if (!part.startsWith('{')) return part
      const [id, factor] = part.slice(1, -1).split(':')
      return <strong key={i}>{describe(id, factor ? Number(factor) : 1)}</strong>
    })}</li>)}</ol>
    {canPlan && <form className="form-row dialog-footer recipe-plan" onSubmit={plan}>
      <label>Inplannen op<select value={target} onChange={event => { setTarget(event.target.value); setConfirmedRecipe(undefined) }}>
        {planningDays.map(day => <option key={day} value={day}>{formatLong(day)}</option>)}
      </select></label>
      <button className="button primary" disabled={busy}>{confirm ? 'Maaltijd vervangen' : 'Plan dit recept'} <Icon name="calendar" size={17}/></button>
      {confirm && <small className="full-width">Op die dag staat al {householdRecipes(state)[existing.recipeId].title}.</small>}
    </form>}
    {publish && <div className="dialog-footer">
      <button className="button" disabled={publishing || !!publicationMessage} onClick={async () => {
        setPublishing(true)
        try {
          await publish()
          setPublicationMessage('Een kopie is ingediend voor beoordeling.')
        } catch (error) {
          setPublicationMessage(error instanceof Error ? error.message : 'Indienen is niet gelukt.')
        } finally { setPublishing(false) }
      }}>Indienen voor publicatie</button>
      {publicationMessage && <p role="status">{publicationMessage}</p>}
    </div>}
  </>
}

function RecipeCards({ recipes, onOpen, filters }: { recipes: Recipe[]; onOpen: (recipe: Recipe) => void; filters?: { selected: string[]; setSelected: (tags: string[]) => void; reset: () => void } }) {
  const [search, setSearch] = useState('')
  const selected = filters?.selected ?? []
  const [filterOpen, setFilterOpen] = useState(false)
  const { tagOptions, active, visible } = filterRecipes(recipes, search, selected)
  return <>
    {filters && <div className="filters">
      <label className="search"><Icon name="search"/><input aria-label="Zoek op receptnaam" placeholder="Zoek op receptnaam…" value={search} onChange={event => setSearch(event.target.value)}/></label>
      <button className={'icon-button filter-button' + (active.length ? ' filter-active' : '')} aria-label={active.length ? 'Filter op kenmerken, ' + active.length + ' actief' : 'Filter op kenmerken'} onClick={() => setFilterOpen(true)}>
        <Icon name="filter"/>{active.length > 0 && <span aria-hidden="true">{active.length}</span>}
      </button>
    </div>}
    {filterOpen && filters && <RecipeFilters {...{ tagOptions, active }} setSelected={filters.setSelected} reset={filters.reset} count={visible.length} close={() => setFilterOpen(false)}/>}
    <RecipeGrid recipes={visible} onOpen={onOpen}/>
  </>
}

function filterRecipes(recipes: Recipe[], search: string, selected: string[]) {
  const tagOptions = [...new Set([...allergyTags, ...selected, ...recipes.flatMap(recipe => [...recipe.tags, recipe.cuisine])])].sort((a, b) => a.localeCompare(b, 'nl'))
  const active = selected.filter(tag => tagOptions.includes(tag))
  const matchingTags = recipes.filter(recipe => active.every(tag => (!isAllergyTag(tag) && recipe.cuisine === tag) || recipe.tags.includes(tag) || (tag === "Vegetarisch" && recipe.tags.includes("Vegan"))))
  const query = nameKey(search)
  const visible = matchingTags.filter(recipe => nameKey(recipe.title).includes(query))
  return { tagOptions, active, visible, matchingTags }
}

function RecipeFilters({ tagOptions, active, setSelected, count, close, reset }: {
  tagOptions: string[]; active: string[]; setSelected: (tags: string[]) => void; count: number; close: () => void; reset?: () => void
}) {
  return <Dialog title="Filter op kenmerken en allergie-informatie" close={close}>
      <p>Toon recepten die aan alle geselecteerde kenmerken voldoen.</p>
      {[false, true].map(allergy => <fieldset className={allergy ? "allergy-fieldset" : undefined} key={String(allergy)}>
        <legend>{allergy ? 'Allergie-informatie' : 'Kenmerken'}</legend>
        <div className="filter-options">{tagOptions.filter(tag => isAllergyTag(tag) === allergy).map(tag => <label className="check-row" key={tag}>
        <input type="checkbox" checked={active.includes(tag)} onChange={event => setSelected(event.target.checked ? [...active, tag] : active.filter(item => item !== tag))}/>
        <span>{tag}</span>
      </label>)}</div></fieldset>)}
      <div className="form-row dialog-footer"><button className="button primary" onClick={close}>Toon {count} {count === 1 ? 'recept' : 'recepten'}</button>
        <button className="button" disabled={!active.length} onClick={() => setSelected([])}>Wis filters</button>{reset && <button className="button" onClick={reset}>Terug naar mijn dieetvoorkeuren</button>}</div>
    </Dialog>
}

function RecipeGrid({ recipes, onOpen, disabled }: { recipes: Recipe[]; onOpen: (recipe: Recipe) => void; disabled?: boolean }) {
  return <>
    <div className="recipe-grid">
      {recipes.map(recipe => <button key={recipe.id} className="recipe-card" disabled={disabled} onClick={() => onOpen(recipe)}>
        <div className={'recipe-art ' + recipe.theme}><RecipeArt recipe={recipe}/><span className="time-pill"><Icon name="clock" size={14}/>{recipe.minutes} min</span></div>
        <div className="recipe-body"><small>{recipe.cuisine}</small><h3>{recipe.title}</h3><p>{recipe.subtitle}</p><Nutrition recipe={recipe}/><div className="tags"><>{[...recipe.tags.filter(isAllergyTag), ...recipe.tags.filter(tag => !isAllergyTag(tag)).slice(0, 2)].map(tag => <span className={isAllergyTag(tag) ? "allergy-tag" : undefined} key={tag}>{tag}</span>)}</><Icon name="arrow" size={18}/></div></div>
      </button>)}
    </div>
    {!recipes.length && <p className="empty">Geen recepten gevonden.</p>}
  </>
}

function MealRecipePicker({ recipes, current, busy, choose }: {
  recipes: Recipe[]; current?: Recipe; busy: boolean; choose: (id: string | null) => void
}) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const { tagOptions, active, visible, matchingTags } = filterRecipes(recipes, search, selected)
  return <>
    <div className="meal-current">
      <strong>{current?.title ?? 'Geen maaltijd gepland'}</strong>
      {current && <button type="button" className="button text" disabled={busy} onClick={() => choose(null)}>Maaltijd verwijderen</button>}
    </div>
    <div className="filters meal-picker">
      <TermPicker label="Zoek op receptnaam" options={matchingTags.map(recipe => ({ ...recipe, name: recipe.title }))}
        maxLength={120} search={search} onSearch={setSearch} expanded={expanded} disabled={busy}
        describe={recipe => recipe.minutes + ' min'} pick={recipe => choose(recipe.id)}
        thumbnail={recipe => recipe.image && <img src={recipe.image} alt="" className="recipe-thumb"/>}/>
      <button type="button" className={'icon-button filter-button' + (active.length ? ' filter-active' : '')}
        aria-label={active.length ? 'Filter op kenmerken, ' + active.length + ' actief' : 'Filter op kenmerken'}
        onClick={() => setFilterOpen(true)}>
        <Icon name="filter"/>{active.length > 0 && <span aria-hidden="true">{active.length}</span>}
      </button>
    </div>
    <button type="button" className="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Resultaten inklappen' : 'Alle zoekresultaten tonen'} ({visible.length})
    </button>
    {expanded && <div className="meal-results"><RecipeGrid recipes={visible} disabled={busy} onOpen={recipe => choose(recipe.id)}/></div>}
    {filterOpen && <RecipeFilters {...{ tagOptions, active, setSelected }} count={visible.length} close={() => setFilterOpen(false)}/>}
  </>
}

function PersonForm({ person, save, busy, linked = false }: {
  person?: Person; save: (action: Action) => Promise<boolean>; busy: boolean; linked?: boolean
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
    {person && !linked && <button type="button" className="button text danger" disabled={busy} onClick={() => {
      if (removing) void save({ type: 'removePerson', id: person.id })
      else setRemoving(true)
    }}>{removing ? 'Bevestig verwijderen' : 'Verwijderen'}</button>}
  </form>
}

function ShoppingExport({ items, extras, close, unitSystem }: {
  items: ReturnType<typeof shoppingItems>; extras: State['extras']; close: () => void; unitSystem: UnitSystem
}) {
  const [options, setOptions] = useState({ 'Opsommingstekens': true, 'Categorieën': true, 'Hoeveelheden': true, 'Dagen': false })
  const [copyStatus, setCopyStatus] = useState('')
  const rows = [
    ...items.map(item => ({
      group: item.group,
      text: item.name + (options.Hoeveelheden ? ' — ' + ingredientAmount(item.total, item.unit, unitSystem) : '') +
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

function Shopping({ state, save, busy, unitSystem }: { state: State; save: (action: Action) => Promise<boolean>; busy: boolean; unitSystem: UnitSystem }) {
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
            <span>{item.name}<small>{later.length ? ingredientAmount(laterAmount, item.unit, unitSystem) + ' later kopen voor ' + later.map(([date]) => formatShort(date)).join(', ') : 'Nodig op ' + item.uses.map(([date]) => formatShort(date)).join(', ')}</small></span>
            <strong>{ingredientAmount(item.total, item.unit, unitSystem)}</strong>
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
    {exportOpen && <ShoppingExport unitSystem={unitSystem} items={items} extras={state.extras} close={() => setExportOpen(false)}/>}
    {!items.length && <p className="empty">Voor deze dagen staan er geen ingrediënten op de boodschappenlijst.</p>}
    <p className="fine-print">Houdbaarheid is een planningsindicatie. Controleer de verpakking en bewaarvoorschriften.</p>
  </>
}

function Profile({ account, person, close, unitSystem, setUnitSystem, diet, setDiet }: { diet: string[]; setDiet: (tags: string[]) => void; account: Account; person?: Person; close: () => void; unitSystem: UnitSystem; setUnitSystem: (value: UnitSystem) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  return <Dialog title="Profiel" close={close}>
    <p>{account.email}</p>
    <form className="form-row" onSubmit={async event => {
      event.preventDefault()
      const fields = new FormData(event.currentTarget)
      const data = Object.fromEntries(fields)
      const preferences = fields.getAll('diet').map(String)
      setBusy(true)
      setError('')
      setMessage('')
      try {
        setMessage((await authRequest('profile', { ...data, dietPreferences: preferences })).message ?? '')
        setUnitSystem(data.unitSystem === 'us' ? 'us' : 'metric')
        setDiet(preferences)
      }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.') }
      finally { setBusy(false) }
    }}>
      <label>Naam<input name="name" defaultValue={person?.name ?? account.name} required maxLength={40}/></label>
      {person && <label>Portiefactor<input name="factor" type="number" defaultValue={person.factor} min={0.25} max={4} step={0.25} required/></label>}
      <label>Maateenheden<select name="unitSystem" defaultValue={unitSystem}><option value="metric">Metrisch (g, ml)</option><option value="us">Amerikaans (oz, cups)</option></select></label>
      <fieldset className="full-width"><legend>Dieetvoorkeuren</legend>
        <div className="form-row">{dietTags.filter(tag => !isAllergyTag(tag)).map(tag => <label className="check-row" key={tag}>
          <input type="checkbox" name="diet" value={tag} defaultChecked={diet.includes(tag)}/>{tag}
        </label>)}</div>
      </fieldset>
      <fieldset className="full-width allergy-fieldset"><legend>Allergie-informatie</legend>
        <div className="form-row">{allergyTags.map(tag => <label className="check-row" key={tag}>
          <input type="checkbox" name="diet" value={tag} defaultChecked={diet.includes(tag)}/>{tag}
        </label>)}</div>
      </fieldset>
      <button className="button primary" disabled={busy}>Profiel opslaan</button>
    </form>
    {error && <p className="alert" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </Dialog>
}

function App({ account, onExpired }: { account: Account; onExpired: () => void }) {
  const { state, save, restore, error, setError, busy } = useHousehold(onExpired)
  const [signingOut, setSigningOut] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [catalogScope, setCatalogScope] = useState<'public' | 'private'>('public')
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(account.unitSystem ?? 'metric')
  const [publishedTerms, setPublishedTerms] = useState<Terms>(emptyTerms)
  const [diet, setDiet] = useState(account.dietPreferences ?? [])
  const filterKey = 'foodplan-recipe-filters:' + account.id
  const [savedFilters, setSavedFilters] = useState<string[] | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(filterKey) ?? 'null')
      return Array.isArray(value) && value.every(tag => typeof tag === 'string') ? value : null
    } catch { return null }
  })
  const recipeFilters = {
    selected: savedFilters ?? diet,
    setSelected(tags: string[]) {
      setSavedFilters(tags)
      try { localStorage.setItem(filterKey, JSON.stringify(tags)) } catch { /* Browser storage unavailable. */ }
    },
    reset() {
      setSavedFilters(null)
      try { localStorage.removeItem(filterKey) } catch { /* Browser storage unavailable. */ }
    },
  }
  const [savingPublic, setSavingPublic] = useState(false)
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>(starterRecipes)
  const [inviting, setInviting] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('planning')
  const [week, setWeek] = useState(() => weekStart(today()))
  const [modal, setModal] = useState<Modal>()
  const [notice, setNotice] = useState('')
  const catalog = state ? householdRecipes(state) : {}
  const recipes = Object.values(catalog)
  const suggestions = starterRecipes.filter(recipe => Object.hasOwn(catalog, recipe.id)).map(recipe => catalog[recipe.id])
  const selectedRecipe = modal?.kind === 'recipe' ? modal.publicRecipe ?? catalog[modal.id] : undefined
  const isPrivate = modal?.kind === 'recipe' && !modal.publicRecipe && Object.hasOwn(state?.recipeEdits ?? {}, modal.id)
  const publicTerms = {
    ingredients: [...publicBaseTerms.ingredients, ...publishedTerms.ingredients],
    tags: [...publicBaseTerms.tags, ...publishedTerms.tags],
  }
  const privateTerms = {
    ingredients: Object.values(state?.customIngredients ?? {}).filter(term => !publicTerms.ingredients.some(item => item.id === term.id)),
    tags: Object.values(state?.customTags ?? {}).filter(term => !publicTerms.tags.some(item => item.id === term.id)),
  }
  const linkedPeople = new Set(state?.linkedPeople)
  useEffect(() => {
    const request = new AbortController()
    void fetch('/api/catalog', { signal: request.signal }).then(async response => {
      if (!response.ok) throw new Error('De publieke recepten konden niet worden geladen.')
      const result: { recipes: Recipe[]; terms: Terms } = await response.json()
      setPublicRecipes(result.recipes)
      setPublishedTerms(result.terms ?? emptyTerms)
    }).catch(failure => { if (!request.signal.aborted) setError(failure.message) })
    return () => request.abort()
  }, [tab, modal?.kind === 'edit', setError])
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
  const newRecipe = () => { setCatalogScope('private'); setModal({ kind: 'edit', isNew: true, recipe: {
    id: newId(), title: '', subtitle: '', cuisine: '', description: '', source: null, minutes: 30, tags: [], theme: 'green', amounts: {}, steps: [''],
  } }) }

  return <>
    <header className="site-header"><div className="header-inner">
      <button className="wordmark" aria-label="Aan tafel, naar weekplanning" onClick={() => navigate('planning')}><span className="brand-icon"><Icon name="leaf" size={23}/></span><span className="brand-name">Aan tafel<span className="brand-dot">.</span></span></button>
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
        <div className="form-row recipe-scopes" aria-label="Receptverzameling">
          <button className={'button ' + (catalogScope === 'public' ? 'primary' : '')} aria-pressed={catalogScope === 'public'} onClick={() => setCatalogScope('public')}>Publieke recepten</button>
          <button className={'button ' + (catalogScope === 'private' ? 'primary' : '')} aria-pressed={catalogScope === 'private'} onClick={() => setCatalogScope('private')}>Privérecepten van je groep</button>
        </div>
        <RecipeCards recipes={catalogScope === 'public' ? publicRecipes : Object.values(state.recipeEdits ?? {})}
          onOpen={recipe => catalogScope === 'public' ? setModal({ kind: 'recipe', id: recipe.id, publicRecipe: recipe }) : openRecipe(recipe)} filters={recipeFilters}/>
      </>}
      {state && tab === 'boodschappen' && <Shopping unitSystem={unitSystem} state={state} save={save} busy={busy}/>}
      {state && tab === 'huisgenoten' && <>
        <div className="page-heading"><div className="eyebrow"><Icon name="people" size={16}/> {state.household.name}</div><h1>Huisgenoten</h1><p>Beheer wie er mee-eet. Portiefactor 1 is één standaardportie.</p></div>
        <section className="panel people-panel household-panel"><h2>Jouw huishouden</h2>
          {state.people.map(person => <article className="housemate" key={person.id + person.name + person.factor}>
            <div className="housemate-status"><strong>{person.name}</strong><small>{linkedPeople.has(person.id) ? 'Account gekoppeld' : 'Zonder account'}</small></div>
            {account.role === 'owner' ? <>
              <PersonForm person={person} save={save} busy={busy} linked={linkedPeople.has(person.id)}/>
              {!linkedPeople.has(person.id) && <button className="button text" onClick={() => setInviting(inviting === person.id ? undefined : person.id)}>
                {inviting === person.id ? 'Uitnodiging sluiten' : 'Nodig ' + person.name + ' uit'}
              </button>}
              {inviting === person.id && !linkedPeople.has(person.id) && <InviteForm person={person}/>}
            </> : <small>Portiefactor {person.factor.toLocaleString('nl-NL')}</small>}
          </article>)}
          {!state.people.length && <p>Er zijn nog geen huisgenoten.</p>}
          {account.role === 'owner' && <><h3>Huisgenoot toevoegen</h3><PersonForm save={save} busy={busy}/></>}
        </section>
      </>}
      {tab === 'beheer' && account.superuser && <AdminPage accountId={account.id} groupId={account.groupId}/>}
    </main>
    <footer className="site-footer">
      <span className="footer-brand"><Icon name="leaf" size={16}/> Aan tafel · Jouw weekmenu</span>
      {account.role === 'owner' && <button className="button text" disabled={!state} onClick={() => { setError(''); setSettingsOpen(true) }}>
        <Icon name="settings" size={17}/> Instellingen
      </button>}
      <button className="button text" disabled={!state} onClick={() => setProfileOpen(true)}>Profiel</button>
      {account.superuser && <button className="button text" onClick={() => navigate('beheer')}>Beheer</button>}
      <button className="button text" disabled={busy || signingOut} onClick={async () => {
        setSigningOut(true)
        try {
          await authRequest('logout')
          onExpired()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Uitloggen is niet gelukt.')
        } finally {
          setSigningOut(false)
        }
      }}>Uitloggen</button>
    </footer>
    {profileOpen && state && <Profile diet={diet} setDiet={setDiet} unitSystem={unitSystem} setUnitSystem={setUnitSystem} account={account} person={state.people.find(person => person.id === account.personId)} close={() => setProfileOpen(false)}/>}
    {settingsOpen && <Settings busy={busy} error={error} restore={restore} clearDatabase={() => save({ type: 'clearDatabase' })} close={() => { setError(''); setSettingsOpen(false) }}/>}
    {state && modal && <Dialog key={modal.kind} printable={modal.kind === "recipe"} fullscreen={modal.kind === "edit"} title={modal.kind === 'recipe' ? selectedRecipe?.title ?? 'Recept' : modal.kind === 'edit' ? (modal.isNew ? 'Recept toevoegen' : 'Recept aanpassen') : formatLong(modal.date)} close={close}>
      {error && <p className="alert" role="alert">{error}</p>}
      {modal.kind === 'recipe' && selectedRecipe && <RecipeDetail key={selectedRecipe.id} recipe={selectedRecipe} unitSystem={unitSystem} ingredients={modal.publicRecipe ? Object.fromEntries(publicTerms.ingredients.map(item => [item.id, item])) : householdIngredients(state)} canPlan={isPrivate || catalog[selectedRecipe.id] === selectedRecipe || (starterRecipes.some(recipe => recipe.id === selectedRecipe.id) && !!catalog[selectedRecipe.id] && !Object.hasOwn(state.recipeEdits ?? {}, selectedRecipe.id))} date={modal.date} state={state} save={save} close={close} busy={busy}
        remove={isPrivate ? async () => { if (await save({ type: 'deleteRecipe', id: selectedRecipe.id })) close() } : undefined}
        edit={isPrivate || (modal.publicRecipe && account.superuser) ? () => setModal({ kind: 'edit', recipe: selectedRecipe, date: modal.date, publicEdit: !!modal.publicRecipe }) : undefined}
        publish={isPrivate ? async () => { await authRequest('publication-submit', { id: selectedRecipe.id }) } : undefined}
        copy={!isPrivate ? async () => {
          const copyId = newId()
          if (await save({ type: 'copyPublicRecipe', id: selectedRecipe.id, copyId })) {
            setCatalogScope('private')
            setModal({ kind: 'recipe', id: copyId })
          }
        } : undefined}/>}
      {modal.kind === 'edit' && <RecipeEditor publicTerms={publicTerms} privateTerms={modal.publicEdit ? emptyTerms : privateTerms} publicOnly={modal.publicEdit} recipe={modal.recipe} busy={busy || savingPublic} cancel={() => {
        setError('')
        if (modal.isNew) close()
        else if (modal.publicEdit) setModal({ kind: 'recipe', id: modal.recipe.id, publicRecipe: modal.recipe })
        else openRecipe(modal.recipe, modal.date)
      }} onSave={async (recipe, terms) => {
        if (modal.publicEdit) {
          setSavingPublic(true)
          setError('')
          try {
            await authRequest('public-recipe-edit', { recipe })
            setPublicRecipes(current => current.map(item => item.id === recipe.id ? recipe : item))
            setModal({ kind: 'recipe', id: recipe.id, publicRecipe: recipe })
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.')
          } finally { setSavingPublic(false) }
          return
        }
        if (await save({ type: 'saveRecipe', recipe, terms })) openRecipe(recipe, modal.date)
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
        <MealRecipePicker key={modal.date} recipes={recipes} current={dayMeal ? catalog[dayMeal.recipeId] : undefined} busy={busy}
          choose={recipeId => void save({ type: 'meal', date: modal.date, recipeId })}/>
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

function Root() {
  const [account, setAccount] = useState<Account | null>()
  const [error, setError] = useState('')
  async function refresh() {
    setError('')
    try {
      const response = await fetch('/api/auth/session')
      if (!response.ok) throw new Error()
      const result: { account: Account | null } = await response.json()
      setAccount(result.account)
    } catch {
      setError('De server is niet bereikbaar.')
    }
  }
  useEffect(() => { void refresh() }, [])
  if (error) return <main><p className="alert" role="alert">{error}</p><button className="button" onClick={refresh}>Probeer opnieuw</button></main>
  if (account === undefined) return <main><p role="status">Aan tafel laden…</p></main>
  if (!account || hasAccountLink()) return <AccountScreen refresh={refresh} signedIn={!!account}/>
  return <App key={account.id} account={account} onExpired={() => setAccount(null)}/>
}

createRoot(document.getElementById('root')!).render(<Root/>)
