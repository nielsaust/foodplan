import type { RefObject } from 'react'
import { FileUpload } from './file-upload'
import { cookingPortions } from '../domain/planning'
import { pagePaths, pageFromPath, adminSections } from '../domain/navigation'
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
import { addDays, amount, ingredientAmount, householdIngredients, canScheduleRecipe, datesFrom, diners, formatDate, householdRecipes, portions, shoppingItems, today, weekStart } from '../domain/planning'
import type { Action, Person, State } from '../domain/planning'
import { Icon, Plate } from './visuals'
import { AccountScreen, authRequest, hasAccountLink } from './account'
import type { Account } from './account'
import { AdminPage } from './admin'
import { nutrition } from '../domain/nutrition'
import { RecipeEditor } from './recipe-editor'
import { useMealDrag } from './meal-drag'
import './style.css'

declare const __BUILD_TIMESTAMP__: string | null

type Snapshot = { state: State; revision: number }
type Tab = 'planning' | 'recepten' | 'boodschappen' | 'huisgenoten' | 'beheer'
type Modal = { kind: 'recipe'; id: string; date?: string; leftoverOf?: string; publicRecipe?: Recipe; reviewIngredients?: Record<string, Ingredient>; reviewStatus?: string } | { kind: 'day'; date: string } | { kind: 'edit'; recipe: Recipe; date?: string; isNew?: boolean; publicEdit?: boolean }
const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'planning', label: 'Weekplanning', icon: 'calendar' },
  { id: 'recepten', label: 'Recepten', icon: 'book' },
  { id: 'boodschappen', label: 'Boodschappen', icon: 'basket' },
  { id: 'huisgenoten', label: 'Huishouden', icon: 'people' },
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
  return <dialog className={printable ? "recipe-print-dialog mobile-fullscreen" : fullscreen ? "mobile-fullscreen" : undefined} ref={ref} aria-labelledby={titleId} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close() }}
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
      <label>Back-upbestand<FileUpload ref={fileInput} accept=".json,application/json" required disabled={pending}
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
  return recipe.image ? <img className="recipe-photo" src={recipe.image} alt="" loading="lazy"/> : <svg className="recipe-placeholder" viewBox="0 0 120 80" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="60" cy="40" r="28"/>
    <circle cx="60" cy="40" r="19"/>
    <path d="M19 20v40m-6-40v12a6 6 0 0 0 12 0V20m77 40V20c-7 5-9 14-9 22h9"/>
  </svg>
}

function Nutrition({ recipe }: { recipe: Recipe }) {
  const values = recipe.nutrition ?? nutrition(recipe)
  if (!values) return null
  const parts = Object.entries(values).map(([key, value]) => value.toLocaleString('nl-NL') + ' ' + nutritionLabels[key as keyof typeof nutritionLabels])
  return parts.length ? <small className="nutrition">{recipe.nutrition ? '' : 'Ca. '}{parts.join(' · ')} per portie</small> : null
}

function CookingMode({ title, steps, initialStep, close }: { title: string; steps: ReactNode[]; initialStep: number; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const titleId = useId()
  const [index, setIndex] = useState(initialStep)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const last = index === steps.length - 1

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  useEffect(() => {
    heading.current?.focus()
  }, [index])

  return <dialog ref={dialog} className="cooking-dialog" aria-labelledby={titleId}
    onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); close() }}>
    <header className="cooking-header">
      <button className="button" onClick={close}><Icon name="left"/> Hele recept</button>
      <strong id={titleId}>{title}</strong>
    </header>
    <progress className="cooking-progress" aria-label="Voortgang van het recept" value={index + 1} max={steps.length}/>
    <h2 className="cooking-counter" ref={heading} tabIndex={-1}>Stap {index + 1} van {steps.length}</h2>
    <section className="cooking-step" key={index}
      onTouchStart={event => {
        swipe.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null
      }}
      onTouchCancel={() => { swipe.current = null }}
      onTouchEnd={event => {
        const start = swipe.current
        swipe.current = null
        if (!start || !event.changedTouches.length) return
        const dx = event.changedTouches[0].clientX - start.x
        const dy = event.changedTouches[0].clientY - start.y
        if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          setIndex(value => Math.max(0, Math.min(steps.length - 1, value + (dx < 0 ? 1 : -1))))
        }
      }}>
      <div className="cooking-instruction">
        <p>{steps[index]}</p>
      </div>
    </section>
    <footer className="cooking-actions">
      <button className="button" disabled={index === 0} onClick={() => setIndex(index - 1)}><Icon name="left"/> Terug</button>
      <button className="button primary" onClick={last ? close : () => setIndex(index + 1)}>
        {last ? 'Klaar' : 'Volgende stap'} <Icon name={last ? 'check' : 'right'}/>
      </button>
    </footer>
  </dialog>
}

function RecipeDetail({ recipe, date, state, save, close, busy, edit, copy, publish, remove, publicRemove, archived, canPlan, ingredients, unitSystem }: {
  recipe: Recipe; date?: string; state: State; save: (action: Action) => Promise<boolean>; close: () => void; busy: boolean; edit?: () => void; copy?: () => void; publish?: () => Promise<void>; remove?: () => Promise<void>; publicRemove?: (status: string) => Promise<void>; archived?: boolean; canPlan: boolean; ingredients: Record<string, Ingredient>; unitSystem: UnitSystem
}) {
  const [publicationMessage, setPublicationMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [deletingPublic, setDeletingPublic] = useState(false)
  const [planning, setPlanning] = useState(false)
  const planningId = useId()
  const [scale, setScale] = useState(date ? cookingPortions(state, date) : 1)
  const [cooking, setCooking] = useState<number | null>(null)
  const planningDays = datesFrom(today(), 7)
  const describe = (id: string, fraction = 1) => {
    const item = ingredients[id]
    return ingredientAmount(recipe.amounts[id] * scale, item.unit, unitSystem, fraction) + ' ' + item.name.toLocaleLowerCase('nl')
  }
  const steps = recipe.steps.map(step => step.split(/(\{[^}]+\})/g).map((part, index) => {
    if (!part.startsWith('{')) return part
    const [id, factor] = part.slice(1, -1).split(':')
    return <strong key={index}>{describe(id, factor ? Number(factor) : 1)}</strong>
  }))
  async function plan(day: string) {
    const existing = state.meals.find(meal => meal.date === day)
    if (existing && existing.recipeId !== recipe.id &&
      !window.confirm('Op ' + formatLong(day) + ' staat al ' + (existing.text ?? householdRecipes(state)[existing.recipeId]?.title ?? 'een maaltijd') + '. Deze maaltijd vervangen?')) return
    if (await save({ type: 'meal', date: day, recipeId: recipe.id })) close()
  }
  return <>
    <div className="detail-art"><RecipeArt recipe={recipe}/></div>
    {(edit || remove || copy || canPlan) && <div className="detail-tools">{edit && !publicRemove && <button className="button" onClick={edit}><Icon name="edit" size={16}/> Recept aanpassen</button>}
    {remove && <button className="button danger" disabled={busy} onClick={() => {
      if (window.confirm('Recept verwijderen? Het verdwijnt ook uit de weekplanning. De ingrediënten blijven bewaard.')) void remove()
    }}>Recept verwijderen</button>}
      {copy && <button className="button" disabled={busy} onClick={copy}><Icon name="copy" size={16}/> Bewaar als privérecept</button>}
      {canPlan && <div className="recipe-plan-picker"
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPlanning(false) }}
        onKeyDown={event => {
          if (event.key === 'Escape' && planning) {
            event.stopPropagation()
            setPlanning(false)
            event.currentTarget.querySelector('button')?.focus()
          }
          if (event.key === 'ArrowDown' && event.target === event.currentTarget.querySelector('button')) {
            event.preventDefault()
            setPlanning(true)
            const picker = event.currentTarget
            requestAnimationFrame(() => picker.querySelector<HTMLButtonElement>('.recipe-plan-days button')?.focus())
          }
        }}>
        <button className="button primary" aria-expanded={planning} aria-controls={planningId}
          onClick={() => setPlanning(value => !value)}>Plan dit recept <Icon name="calendar" size={17}/></button>
        {planning && <div id={planningId} className="recipe-plan-days" aria-label="Kies een dag">
          {planningDays.map(day => {
            const meal = state.meals.find(item => item.date === day)
            return <button key={day} disabled={busy} onClick={() => void plan(day)}>
              <strong>{formatLong(day)}</strong>
              {meal && <small>{meal.text ?? householdRecipes(state)[meal.recipeId]?.title}</small>}
            </button>
          })}
        </div>}
      </div>}
    </div>}
    {archived && <p className="alert">Dit recept is verborgen. Bewaar het als privérecept om het opnieuw in te plannen.</p>}
    <p className="recipe-meta"><Icon name="clock" size={16}/> {recipe.minutes} min <span>·</span> {recipe.cuisine}</p>
    <Nutrition recipe={recipe}/>
    <p>{recipe.description}</p>
    {recipe.source === null && <p className="fine-print">Origineel recept</p>}
    {recipe.source && <p className="fine-print">Bron: <a href={recipe.source} target="_blank" rel="noreferrer">{new URL(recipe.source).hostname}</a></p>}
    <div className="tags">{recipe.tags.map(tag => <span className={isAllergyTag(tag) ? "allergy-tag" : undefined} key={tag}>{tag}</span>)}</div>
    <div className="portion-bar">
      <div><strong>Hoeveelheden</strong><small>{date ? 'Start met de porties van de mee-eters' : 'Het basisrecept is voor één persoon'}</small></div>
      <div className="portion-stepper segmented-control">
        <button type="button" className="icon-button" aria-label="Eén portie minder" disabled={scale <= 0} onClick={() => setScale(value => Math.max(0, value - 1))}>−</button>
        <label><input type="number" min="0" max="200" step="0.25" aria-label="Aantal porties" value={scale} onChange={event => {
          const value = event.target.valueAsNumber
          if (Number.isFinite(value) && value >= 0 && value <= 200) setScale(value)
        }}/><span>{scale === 1 ? 'portie' : 'porties'}</span></label>
        <button type="button" className="icon-button" aria-label="Eén portie meer" disabled={scale >= 200} onClick={() => setScale(value => Math.min(200, value + 1))}>+</button>
      </div>
    </div>
    <p className="print-portions">Voor {amount(scale, scale === 1 ? "portie" : "porties")}</p>
    <h3>Ingrediënten</h3>
    <ul className="ingredients">{Object.entries(recipe.amounts).map(([id, base]) => <li key={id}><span>{ingredients[id].name}</span><strong>{ingredientAmount(base * scale, ingredients[id].unit, unitSystem)}</strong></li>)}</ul>
    <div className="steps-heading">
      <h3>Stap voor stap</h3>
      <button className="button" onClick={() => setCooking(0)}>Kookmodus</button>
    </div>
    <ol className="steps">{steps.map((step, index) => <li key={index}><div className="recipe-step-row"><span>{step}</span>
      <button className="icon-button" title={'Open stap ' + (index + 1) + ' in kookmodus'} aria-label={'Open stap ' + (index + 1) + ' in kookmodus'} onClick={() => setCooking(index)}><Icon name="book"/></button>
    </div></li>)}</ol>
    {cooking !== null && <CookingMode title={recipe.title} steps={steps} initialStep={cooking} close={() => setCooking(null)}/>}

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
    {publicRemove && <footer className="recipe-admin-footer">
      <small>Beheer · Alleen zichtbaar voor superusers</small>
      <div className="form-row">
        {edit && <button className="admin-text-link" onClick={edit}>Recept aanpassen</button>}
        <button className="admin-text-link danger" disabled={busy}
          onClick={() => setDeletingPublic(value => !value)}>Recept verwijderen</button>
      </div>
    {deletingPublic && publicRemove && <section className="alert">
      <p>Verbergen houdt geplande maaltijden beschikbaar. Definitief verwijderen haalt het recept ook uit de weekplanningen.</p>
      <div className="form-row">
        <button className="button" disabled={busy || archived} onClick={() => void publicRemove('archived')}>Verbergen</button>
        <button className="button danger" disabled={busy} onClick={() => {
          if (window.confirm('Dit publieke recept definitief verwijderen, ook uit weekplanningen?')) void publicRemove('deleted')
        }}>Definitief verwijderen</button>
        <button className="button" onClick={() => setDeletingPublic(false)}>Annuleren</button>
      </div>
    </section>}
    </footer>}

  </>
}

function RecipeCards({ recipes, onOpen, filters, onAdd }: { onAdd?: () => void; recipes: Recipe[]; onOpen: (recipe: Recipe) => void; filters?: { selected: string[]; setSelected: (tags: string[]) => void; reset: () => void } }) {
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
    <RecipeGrid recipes={visible} onOpen={onOpen} onAdd={onAdd}/>
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

function RecipeFilters({ tagOptions, active, setSelected, count, close, reset, collection }: {
  tagOptions: string[]; active: string[]; setSelected: (tags: string[]) => void; count: number; close: () => void; reset?: () => void; collection?: ReactNode
}) {
  return <Dialog title="Filter op kenmerken en allergie-informatie" close={close}>
      {collection}
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

function RecipeGrid({ recipes, onOpen, disabled, onAdd, collectionBadge }: { collectionBadge?: (id: string) => ReactNode; onAdd?: () => void; recipes: Recipe[]; onOpen: (recipe: Recipe) => void; disabled?: boolean }) {
  return <>
    <div className="recipe-grid">
      {onAdd && <button type="button" className="recipe-card add-recipe-card" onClick={onAdd}>
        <div className="recipe-art add-recipe-art"><Icon name="plus" size={50}/></div>
        <div className="recipe-body"><h3>Recept toevoegen</h3><p>Maak een nieuw recept voor je privécollectie.</p></div>
      </button>}
      {recipes.map(recipe => <button key={recipe.id} className="recipe-card" disabled={disabled} onClick={() => onOpen(recipe)}>
        <div className="recipe-art"><RecipeArt recipe={recipe}/><span className="time-pill"><Icon name="clock" size={14}/>{recipe.minutes} min {collectionBadge?.(recipe.id)}</span></div>
        <div className="recipe-body"><small>{recipe.cuisine}</small><h3>{recipe.title}</h3><p>{recipe.subtitle}</p><Nutrition recipe={recipe}/><div className="tags"><>{[...recipe.tags.filter(isAllergyTag), ...recipe.tags.filter(tag => !isAllergyTag(tag)).slice(0, 2)].map(tag => <span className={isAllergyTag(tag) ? "allergy-tag" : undefined} key={tag}>{tag}</span>)}</><Icon name="arrow" size={18}/></div></div>
      </button>)}
    </div>
    {!recipes.length && <p className="empty">Geen recepten gevonden.</p>}
  </>
}

function DayMealPicker({ date, state, recipes, busy, save, openRecipe, beforeDone }: {
  date: string; state: State; recipes: Recipe[]; busy: boolean; save: (action: Action) => Promise<boolean>; openRecipe: (recipe: Recipe, date?: string) => void; beforeDone: RefObject<(() => Promise<boolean>) | null>
}) {
  const meal = state.meals.find(item => item.date === date)
  const currentRecipe = meal ? householdRecipes(state)[meal.recipeId] : undefined
  const [editing, setEditing] = useState(!meal)
  const [mode, setMode] = useState(meal?.leftoverOf ? 'leftover' : meal?.text ? 'text' : 'recipe')
  const [text, setText] = useState(meal?.text ?? '')
  useEffect(() => {
    beforeDone.current = async () => {
      if (mode !== 'text' || !editing || !text.trim() || text.trim() === meal?.text) return true
      return save({ type: 'meal', date, recipeId: null, text: text.trim() })
    }
    return () => { beforeDone.current = null }
  }, [beforeDone, mode, editing, text, meal?.text, date, save])
  async function choose(recipeId: string | null, text?: string) {
    if (await save({ type: 'meal', date, recipeId, ...(text === undefined ? {} : { text }) })) setEditing(recipeId === null && text === undefined)
  }
  return <section className="day-dinner">
    <h3>Avondeten</h3>
    <div className="day-planned">
      {currentRecipe && <div className="day-planned-photo"><RecipeArt recipe={currentRecipe}/></div>}
      <div>
        <small>{meal?.leftoverOf ? 'Kliek · Opwarmen' : meal ? 'Gepland' : 'Nog niets gepland'}</small>
        <strong>{meal?.text ?? currentRecipe?.title ?? 'Wat eten we deze dag?'}</strong>
        {currentRecipe && (meal?.leftoverOf ? <><small>Warm het gerecht van {formatShort(meal.leftoverOf)} op.</small><button className="button text" onClick={() => openRecipe(currentRecipe, meal.leftoverOf)}>Open origineel recept</button></> : <small>{currentRecipe.minutes} min · {currentRecipe.cuisine}</small>)}
      </div>
      {meal && <div className="day-planned-actions">
        <button className="button" disabled={busy} aria-expanded={editing} onClick={() => {
          setText(meal.text ?? '')
          setEditing(value => !value)
        }}>{editing ? 'Sluiten' : 'Wijzigen'}</button>
        <button className="icon-button" disabled={busy} aria-label="Planning verwijderen" title="Planning verwijderen" onClick={() => void choose(null)}><Icon name="close"/></button>
      </div>}
    </div>
    {(editing || !meal) && <div className="day-meal-editor">
      <div className="day-meal-modes" role="group" aria-label="Soort avondplanning">
        <button className={'button' + (mode === 'recipe' ? ' primary' : '')} aria-pressed={mode === 'recipe'} onClick={() => setMode('recipe')}>Recept kiezen</button>
        <button className={'button' + (mode === 'text' ? ' primary' : '')} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Zelf invullen</button>
        <button className={'button' + (mode === 'leftover' ? ' primary' : '')} aria-pressed={mode === 'leftover'} onClick={() => setMode('leftover')}>Kliek</button>
      </div>
      {mode === 'recipe' ? <MealRecipePicker privateIds={Object.keys(state.recipeEdits ?? {})} recipes={recipes} busy={busy} choose={recipeId => void choose(recipeId)}/>
        : mode === 'leftover' ? <div className="leftover-options"><p>Kies een kookdag uit de afgelopen drie dagen. De extra porties worden op die dag meegerekend.</p>
          {state.meals.filter(item => !item.leftoverOf && !item.text && [1, 2, 3].some(days => addDays(item.date, days) === date) && householdRecipes(state)[item.recipeId]).sort((a, b) => b.date.localeCompare(a.date)).map(item => <button className="recipe-card leftover-card" key={item.date} disabled={busy} onClick={async () => {
            if (await save({ type: 'meal', date, recipeId: item.recipeId, leftoverOf: item.date })) setEditing(false)
          }}><span className="leftover-day-banner">{addDays(item.date, 1) === date ? 'Gisteren' : addDays(item.date, 2) === date ? 'Eergisteren' : '3 dagen geleden'}</span><div className="leftover-image"><RecipeArt recipe={householdRecipes(state)[item.recipeId]}/></div><div className="recipe-body"><h3>{householdRecipes(state)[item.recipeId].title}</h3></div></button>)}
          {!state.meals.some(item => !item.leftoverOf && !item.text && [1, 2, 3].some(days => addDays(item.date, days) === date)) && <p>Geen geschikte kookdagen gevonden.</p>}
        </div> : <form className="day-text-form" onSubmit={event => {
          event.preventDefault()
          void choose(null, text)
        }}>
          <label>Wat staat er gepland?
            <span className="day-text-input-group"><input required maxLength={160} value={text} disabled={busy} placeholder="Bijv. uit eten of eten bestellen" onChange={event => setText(event.target.value)}/>
            <button type="submit" className="button" aria-label="Planning opslaan" title="Planning opslaan" disabled={busy || !text.trim()}><Icon name="save"/></button></span>
          </label>
        </form>}
    </div>}
  </section>
}

function MealRecipePicker({ recipes, privateIds, busy, choose }: {
  recipes: Recipe[]; privateIds: string[]; busy: boolean; choose: (id: string | null) => void
}) {
  const [scope, setScope] = useState('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const scopedRecipes = recipes.filter(recipe => scope === 'all' || (scope === 'private') === privateIds.includes(recipe.id))
  const { tagOptions, active, visible, matchingTags } = filterRecipes(scopedRecipes, search, selected)
  const collectionBadge = (id: string) => <span className="recipe-collection" title={privateIds.includes(id) ? 'Privérecept' : 'Publiek recept'}>
    <Icon name={privateIds.includes(id) ? 'lock' : 'globe'} size={15}/>
    <span className="sr-only">{privateIds.includes(id) ? 'Privé' : 'Publiek'}</span>
  </span>
  return <>
    <div className="filters meal-picker">
      <TermPicker label="Zoek op receptnaam" options={matchingTags.map(recipe => ({ ...recipe, name: recipe.title }))}
        maxLength={120} search={search} onSearch={setSearch} expanded={expanded} disabled={busy}
        describe={recipe => <span className="recipe-result-meta">{recipe.minutes} min {collectionBadge(recipe.id)}</span>} pick={recipe => choose(recipe.id)}
        thumbnail={recipe => <span className="recipe-thumb"><RecipeArt recipe={recipe}/></span>}/>
      <button type="button" className={'icon-button filter-button' + (active.length ? ' filter-active' : '')}
        aria-label={active.length ? 'Filter op kenmerken, ' + active.length + ' actief' : 'Filter op kenmerken'}
        onClick={() => setFilterOpen(true)}>
        <Icon name="filter"/>{active.length > 0 && <span aria-hidden="true">{active.length}</span>}
      </button>
    </div>
    <button type="button" className="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Resultaten inklappen' : 'Alle zoekresultaten tonen'} ({visible.length})
    </button>
    {expanded && <div className="meal-results"><RecipeGrid collectionBadge={collectionBadge} recipes={visible} disabled={busy} onOpen={recipe => choose(recipe.id)}/></div>}
    {filterOpen && <RecipeFilters {...{ tagOptions, active, setSelected }} count={visible.length} close={() => setFilterOpen(false)} collection={
      <label className="collection-filter">Collectie
        <select value={scope} onChange={event => setScope(event.target.value)}>
          <option value="all">Alle recepten</option>
          <option value="public">Publiek</option>
          <option value="private">Privé van je groep</option>
        </select>
      </label>
    }/>}
  </>
}

function HousemateInvitation({ person, linked }: { person: Person; linked: boolean }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [invitation, setInvitation] = useState<{ email: string; expires: number }>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function load() {
    const result = await authRequest('invitations') as unknown as { invitations: { personId: string; email: string; expires: number }[] }
    const item = result.invitations.find((item: { personId: string }) => item.personId === person.id)
    setInvitation(item)
    if (item) setEmail(item.email)
  }
  useEffect(() => { if (!linked) void load().catch(failure => setError(failure.message)) }, [person.id, linked])
  async function act(route: string) {
    setPending(true)
    setError('')
    setMessage('')
    try {
      const result = await authRequest(route, { personId: person.id, email })
      await load()
      setMessage(result.message ?? '')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Aanvraag mislukt.') }
    finally { setPending(false) }
  }
  return <div className="housemate-invitation">
    {linked ? <span className="account-link-tag"><Icon name="link" size={16}/> Gekoppeld</span> : <>
      <button type="button" className="button account-invite" title={invitation ? 'Uitgenodigd · ' + invitation.email : 'Zonder account: uitnodigen'} onClick={() => setOpen(true)}><Icon name="unlink" size={16}/>{invitation ? 'Uitgenodigd' : 'Uitnodigen'}</button>
      {error && !open && <small role="alert">{error}</small>}
    </>}
    {open && <Dialog title={person.name + ' uitnodigen'} close={() => { if (!pending) setOpen(false) }}>
      <p>Het account wordt gekoppeld aan {person.name}.</p>
      {invitation && <p>Uitnodiging verstuurd naar {invitation.email}. Geldig tot {new Date(invitation.expires).toLocaleDateString('nl-NL')}.</p>}
      <form className="invite-modal-form" onSubmit={event => { event.preventDefault(); void act('invite') }}>
        <label>E-mailadres<input type="email" required maxLength={254} value={email} disabled={pending} onChange={event => setEmail(event.target.value)}/></label>
        <div className="form-row">
          <button className="button primary" disabled={pending}>{invitation ? 'Opnieuw versturen' : 'Uitnodiging versturen'}</button>
          {invitation && <button type="button" className="button danger" disabled={pending} onClick={() => void act('invite-revoke')}>Intrekken</button>}
        </div>
      </form>
      {error && <p className="alert" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </Dialog>}
  </div>
}

function PersonForm({ person, save, busy, linked = false }: {
  person?: Person; save: (action: Action) => Promise<boolean>; busy: boolean; linked?: boolean
}) {
  const formId = useId()
  const [name, setName] = useState(person?.name ?? '')
  const [factor, setFactor] = useState(String(person?.factor ?? 1))
  const [removing, setRemoving] = useState(false)
  return <div className="form-row person-form"><form id={formId} className="person-submit-form" onSubmit={async event => {
    event.preventDefault()
    if (await save({ type: 'person', id: person?.id ?? newId(), name, factor: Number(factor) }) && !person) {
      setName('')
      setFactor('1')
    }
  }}/><div className="person-name-field"><label htmlFor={formId + '-name'}>Naam</label><div className="person-name-group"><input form={formId} id={formId + '-name'} value={name} maxLength={40} required placeholder="Naam huisgenoot" onChange={event => setName(event.target.value)}/>{person && <HousemateInvitation person={person} linked={linked}/>}</div></div>
    <label>Portiefactor<input form={formId} type="number" value={factor} min={0.25} max={4} step={0.25} required onChange={event => setFactor(event.target.value)}/></label>
    <button form={formId} className={'button ' + (person ? '' : 'primary')} disabled={busy}>{person ? 'Opslaan' : 'Toevoegen'}</button>
    {person && !linked && <button type="button" className="button danger" disabled={busy} onClick={() => {
      if (removing) void save({ type: 'removePerson', id: person.id })
      else setRemoving(true)
    }}>{removing ? 'Bevestig verwijderen' : 'Verwijderen'}</button>}
  </div>
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
    <div className="form-row shop-controls">
        <label>Ik doe boodschappen op<input type="date" value={start} onChange={event => { if (event.target.value) setStart(event.target.value) }}/></label>
        <label>Voor hoeveel dagen?<select value={days} onChange={event => setDays(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7, 14].map(n => <option key={n} value={n}>{n} {n === 1 ? 'dag' : 'dagen'}</option>)}</select></label>
    </div>
    <section className="progress" aria-label="Voortgang boodschappen">
        <strong role="status">{checked} van {total} afgevinkt</strong>
        <progress aria-label="Afgevinkte boodschappen" max={total || 1} value={checked}/>
        <div className="progress-actions">
          <button className="button" disabled={busy || total === 0} onClick={() => void save({ type: 'checkAll', start, days, checked: checked !== total })}>{total > 0 && checked === total ? 'Alle vinkjes wissen' : 'Alles afvinken'}</button>
        <button className="button" disabled={busy || checked === 0}
          onClick={() => void save({ type: 'removeChecked', start, days })}>Verwijder afgevinkte items</button>
        </div>
    </section>
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
  const dayBeforeDone = useRef<(() => Promise<boolean>) | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [addPersonOpen, setAddPersonOpen] = useState(false)
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
  const [adminRevision, setAdminRevision] = useState(0)
  const [savingPublic, setSavingPublic] = useState(false)
  const [publicRecipes, setPublicRecipes] = useState<Recipe[]>(starterRecipes)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const readPage = (): Tab => pageFromPath(window.location.pathname.replace(/\/$/, '') || '/')
  const [tab, setTab] = useState<Tab>(readPage)
  useEffect(() => {
    const url = new URL(window.location.href)
    const legacy = url.searchParams.get('page')
    if (legacy && Object.hasOwn(pagePaths, legacy)) {
      url.pathname = pagePaths[legacy as Tab]
      const section = url.searchParams.get('section')
      if (legacy === 'beheer' && adminSections.includes(section as typeof adminSections[number])) url.pathname += '/' + section
      url.searchParams.delete('page')
      url.searchParams.delete('section')
      window.history.replaceState(null, '', url)
      setTab(readPage())
    }
    const restorePage = () => { setTab(readPage()); setModal(undefined); setSettingsOpen(false); setProfileOpen(false); setAddPersonOpen(false) }
    window.addEventListener('popstate', restorePage)
    return () => window.removeEventListener('popstate', restorePage)
  }, [])
  const [week, setWeek] = useState(() => weekStart(today()))
  const [modal, setModal] = useState<Modal>()
  const [notice, setNotice] = useState('')
  const catalog = state ? householdRecipes(state) : {}
  const recipes = state ? Object.values(catalog).filter(recipe => canScheduleRecipe(state, recipe.id)) : []
  const suggestions = starterRecipes.filter(recipe => state?.includeStarterRecipes !== false && state && canScheduleRecipe(state, recipe.id)).map(recipe => catalog[recipe.id])
  const selectedRecipe = modal?.kind === 'recipe' ? modal.publicRecipe ?? catalog[modal.id] : undefined
  const isPrivate = modal?.kind === 'recipe' && !modal.publicRecipe && Object.hasOwn(state?.recipeEdits ?? {}, modal.id)
  const archived = !!selectedRecipe && (modal?.kind === 'recipe' && modal.reviewStatus === 'archived' ||
    (!isPrivate && !!state?.archivedRecipeIds?.includes(selectedRecipe.id)))
  const isPublished = !!selectedRecipe && !isPrivate && (modal?.kind === 'recipe' && modal.reviewStatus
    ? modal.reviewStatus === 'approved' : !!state?.publicRecipes?.[selectedRecipe.id] && !archived)
  const publicTerms = {
    ingredients: [...publicBaseTerms.ingredients.filter(term => !publishedTerms.ingredients.some(item => item.id === term.id)), ...publishedTerms.ingredients],
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
  async function moveMeal(from: string, to: string, insert = false) {
    const meal = state?.meals.find(meal => meal.date === from)
    if (!meal) return
    const { recipeId, text } = meal
    if (await save({ type: 'moveMeal', from, to, recipeId, text, insert })) {
      setWeek(weekStart(to))
      setNotice('Maaltijd verplaatst naar ' + formatLong(to) + '.')
      close()
    }
  }
  const { drag, handlers } = useMealDrag((from, to) => void moveMeal(from, to, true))
  const current = today()
  const todayMeal = state?.meals.find(meal => meal.date === current)
  const todayRecipe = todayMeal && catalog[todayMeal.recipeId]
  const days = datesFrom(week, 7)
  const planned = state?.meals.filter(meal => days.includes(meal.date)).length ?? 0
  const navigate = (id: Tab) => {
    const url = new URL(window.location.href)
    url.pathname = pagePaths[id]
    url.searchParams.delete('page')
    url.searchParams.delete('section')
    if (url.href !== window.location.href) window.history.pushState(null, '', url)
    setTab(id); setNotice(''); window.scrollTo(0, 0) }
  const openRecipe = (recipe: Recipe, date?: string) => setModal({ kind: 'recipe', id: recipe.id, date })
  const openLeftover = (recipe: Recipe, date: string, leftoverOf: string) => setModal({ kind: 'recipe', id: recipe.id, date, leftoverOf })
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
            <h1>{todayRecipe ? todayRecipe.title : <>Wat eten we<br/>deze week?</>}</h1>
            <p>{todayRecipe ? (todayMeal?.leftoverOf ? 'Vanavond · Kliek opwarmen' : `Vanavond · ${todayRecipe.minutes} min · ${todayRecipe.cuisine}`) : 'Plan je avondeten, houd bij wie er mee-eet en neem je boodschappenlijst mee naar de winkel.'}</p>
            <button className="button hero-button" onClick={() => todayRecipe ? (todayMeal?.leftoverOf ? openLeftover(todayRecipe, current, todayMeal.leftoverOf) : openRecipe(todayRecipe, current)) : navigate('boodschappen')}><Icon name={todayRecipe ? 'book' : 'basket'}/> {todayRecipe ? 'Open recept' : 'Naar boodschappen'} <Icon name="arrow" size={17}/></button>
          </div>
          {todayRecipe ? <div className="hero-recipe-photo"><RecipeArt recipe={todayRecipe}/></div> : <Plate theme="green" hero/>}
        </section>
        <section className="schedule" aria-labelledby="week-title">
          <div className="section-heading">
            <div><h2 id="week-title">Weekplanning</h2><p>{planned} {planned === 1 ? 'maaltijd gepland' : 'maaltijden gepland'}</p></div>
            <div className="week-controls segmented-control" role="group" aria-label="Week kiezen">
              <button className="icon-button" aria-label="Vorige week" onClick={() => { setWeek(addDays(week, -7)); setNotice('') }}><Icon name="left"/></button>
              <button className="week-range" title="Terug naar deze week" onClick={() => { setWeek(weekStart(current)); setNotice('') }}>{formatShort(week)} – {formatShort(days[6])}</button>
              <button className="icon-button" aria-label="Volgende week" onClick={() => { setWeek(addDays(week, 7)); setNotice('') }}><Icon name="right"/></button>
            </div>
          </div>
          <div className="panel day-list">{days.map(date => {
            const meal = state.meals.find(item => item.date === date)
            const recipe = meal && catalog[meal.recipeId]
            const guests = diners(state, date)
            const draggable = !busy && !!meal && (!!meal.text || (!!recipe && canScheduleRecipe(state, recipe.id)))
            const dropClass = drag?.from === date ? ' drag-source' : drag?.to === date ? ' drop-before'
              : date === days[6] && drag?.to === addDays(date, 1) ? ' drop-after' : ''
            return <div className={'day-row ' + (date === current ? 'is-today' : '') + dropClass + (draggable ? ' draggable-meal' : '')} data-meal-date={date}
              data-occupied={meal ? 'true' : undefined} data-after={addDays(date, 1)} {...(draggable ? handlers(date) : {})} key={date} aria-current={date === current ? 'date' : undefined}>
              <div className="day-date"><span>{formatDate(date, { weekday: 'short' }).replace('.', '')}</span><strong>{formatDate(date, { day: 'numeric' })}</strong></div>
              {recipe ? <button className="meal-title" disabled={busy} onClick={() => meal?.leftoverOf ? openLeftover(recipe, date, meal.leftoverOf) : openRecipe(recipe, date)}><span><strong>{recipe.title}</strong><small>{meal?.leftoverOf ? 'Kliek · Opwarmen · ' + formatShort(meal.leftoverOf) : recipe.minutes + ' min · ' + recipe.cuisine}{!meal?.leftoverOf && state.meals.some(item => item.leftoverOf === date) ? ' · Voor ' + (1 + state.meals.filter(item => item.leftoverOf === date).length) + ' dagen' : ''}</small></span></button>
                : meal?.text ? <button className="meal-title" disabled={busy} onClick={() => openDay(date)}><strong>{meal.text}</strong></button>
                : <button className="add-meal" onClick={() => openDay(date)}><Icon name="plus" size={17}/> Maaltijd plannen</button>}
              {date === current && <span className="today-pill">Vandaag</span>}
              <button className={'guests' + (guests.length !== state.people.length ? ' guests-partial' : '')} onClick={() => openDay(date)} title={guests.length + ' van ' + state.people.length + ' huisgenoten eten mee'} aria-label={'Mee-eters op ' + formatLong(date) + ': ' + guests.length + ' van ' + state.people.length + ' huisgenoten'}><Icon name={guests.length !== state.people.length ? 'person-minus' : 'people'} size={17}/><span>{guests.length} <span className="guest-label">mee</span></span></button>
              <button className="icon-button day-more" aria-label={'Bewerk ' + formatLong(date)} onClick={() => openDay(date)}><Icon name="dots" size={18}/></button>
            </div>
          })}</div>
          <p className="fine-print">Houd een rij ingedrukt en sleep naar de invoeglijn. Bezette dagen schuiven door.</p>
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
        <div className="page-heading"><div className="eyebrow"><Icon name="book" size={16}/> Het receptenboek</div><h1>Recepten</h1><p>Vind en filter recepten, voeg je eigen gerechten toe of pas een recept aan.</p></div>
        <div className="form-row recipe-scopes" aria-label="Receptverzameling">
          <button className={'button ' + (catalogScope === 'public' ? 'primary' : '')} aria-pressed={catalogScope === 'public'} onClick={() => setCatalogScope('public')}>Publieke recepten</button>
          <button className={'button ' + (catalogScope === 'private' ? 'primary' : '')} aria-pressed={catalogScope === 'private'} onClick={() => setCatalogScope('private')}>Privérecepten van je groep</button>
        </div>
        <RecipeCards recipes={catalogScope === 'public' ? publicRecipes : Object.values(state.recipeEdits ?? {})}
          onOpen={recipe => catalogScope === 'public' ? setModal({ kind: 'recipe', id: recipe.id, publicRecipe: recipe }) : openRecipe(recipe)} filters={recipeFilters} onAdd={catalogScope === "private" ? newRecipe : undefined}/>
      </>}
      {state && tab === 'boodschappen' && <Shopping unitSystem={unitSystem} state={state} save={save} busy={busy}/>}
      {state && tab === 'huisgenoten' && <>
        <div className="page-heading"><div className="eyebrow"><Icon name="people" size={16}/> {state.household.name}</div><h1>Huishouden</h1><p>Beheer wie er mee-eet. Portiefactor 1 is één standaardportie.</p></div>
        <section className="panel people-panel household-panel"><h2>Jouw huishouden</h2>
          {account.role === 'owner' ? <form className="form-row household-name" onSubmit={event => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void save({ type: 'renameHousehold', name: String(data.get('householdName')) })
          }}><label>Naam huishouden<input key={state.household.name} name="householdName" defaultValue={state.household.name} required maxLength={80}/></label><button className="button" disabled={busy}>Groepsnaam opslaan</button></form> : <p>Alleen de eigenaar kan dit huishouden aanpassen.</p>}
        </section>
        <section className="panel people-panel household-members">
          <div className="household-members-heading"><h2>Leden</h2>{account.role === 'owner' && <button className="button primary" onClick={() => setAddPersonOpen(true)}><Icon name="plus"/> Huisgenoot toevoegen</button>}</div>
          {addPersonOpen && account.role === 'owner' && <Dialog title="Huisgenoot toevoegen" close={() => { if (!busy) setAddPersonOpen(false) }}>
            <p>Portiefactor 1 is één standaardportie.</p>
            <PersonForm busy={busy} save={async action => {
              const saved = await save(action)
              if (saved) setAddPersonOpen(false)
              return saved
            }}/>
            {error && <p className="alert" role="alert">{error}</p>}
          </Dialog>}
          {[...state.people].sort((a, b) => Number(state.ownerPeople?.includes(b.id) ?? false) - Number(state.ownerPeople?.includes(a.id) ?? false)).map(person => <article className={'housemate' + (state.ownerPeople?.includes(person.id) ? ' is-owner' : '')} key={person.id + person.name + person.factor}>
            {state.ownerPeople?.includes(person.id) && <div className="housemate-owner">Eigenaar van het huishouden</div>}
            {account.role === 'owner' ? <>
              <PersonForm person={person} save={save} busy={busy} linked={linkedPeople.has(person.id)}/>

            </> : <div><strong>{person.name}</strong><small> · Portiefactor {person.factor.toLocaleString('nl-NL')}</small></div>}
          </article>)}
          {!state.people.length && <p>Er zijn nog geen huisgenoten.</p>}
        </section>
      </>}
      {tab === 'beheer' && account.superuser && <AdminPage revision={adminRevision} accountId={account.id} groupId={account.groupId} openRecipe={(review, status) => setModal({
        kind: 'recipe', id: review.recipe.id, publicRecipe: review.recipe, reviewIngredients: review.ingredients, reviewStatus: status,
      })}/>}
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
    {state && modal && <Dialog key={modal.kind} printable={modal.kind === "recipe" && !modal.leftoverOf} fullscreen={modal.kind === "edit" || modal.kind === "day" || (modal.kind === "recipe" && !!modal.leftoverOf)} title={modal.kind === 'recipe' ? selectedRecipe?.title ?? 'Recept' : modal.kind === 'edit' ? (modal.isNew ? 'Recept toevoegen' : 'Recept aanpassen') : formatLong(modal.date)} close={close}>
      {error && <p className="alert" role="alert">{error}</p>}
      {modal.kind === 'recipe' && modal.leftoverOf && selectedRecipe && <>
        <RecipeArt recipe={selectedRecipe}/>
        <p className="recipe-meta">{selectedRecipe.cuisine}</p>
        <Nutrition recipe={selectedRecipe}/>
        <p>{selectedRecipe.description}</p>
        <div className="tags">{selectedRecipe.tags.map(tag => <span className={isAllergyTag(tag) ? 'allergy-tag' : undefined} key={tag}>{tag}</span>)}</div>
        <div className="leftover-reference"><strong>Kliek · Opwarmen</strong><p>Warm het gerecht van {formatLong(modal.leftoverOf)} op.</p><button className="button primary" onClick={() => openRecipe(selectedRecipe, modal.leftoverOf)}><Icon name="book"/> Open origineel recept</button></div>
      </>}
      {modal.kind === 'recipe' && !modal.leftoverOf && selectedRecipe && <RecipeDetail key={selectedRecipe.id} recipe={selectedRecipe} unitSystem={unitSystem} ingredients={modal.reviewIngredients ?? (modal.publicRecipe ? Object.fromEntries(publicTerms.ingredients.map(item => [item.id, item])) : householdIngredients(state))}
        archived={archived} canPlan={isPrivate || isPublished} date={modal.date} state={state} save={save} close={close} busy={busy || savingPublic}
        publicRemove={account.superuser && (isPublished || archived) ? async status => {
          setSavingPublic(true)
          setError('')
          try {
            await authRequest('publication-decide', { id: selectedRecipe.id, status })
            setPublicRecipes(current => current.filter(item => item.id !== selectedRecipe.id))
            if (tab === 'beheer') setAdminRevision(value => value + 1)
            close()
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Verwijderen is niet gelukt.')
          } finally { setSavingPublic(false) }
        } : undefined}
        remove={isPrivate ? async () => { if (await save({ type: 'deleteRecipe', id: selectedRecipe.id })) close() } : undefined}
        edit={isPrivate || (isPublished && account.superuser) ? () => setModal({ kind: 'edit', recipe: selectedRecipe, date: modal.date, publicEdit: !isPrivate }) : undefined}
        publish={isPrivate ? async () => { await authRequest('publication-submit', { id: selectedRecipe.id }) } : undefined}
        copy={isPublished || (archived && state.meals.some(meal => meal.recipeId === selectedRecipe.id)) ? async () => {
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
            await authRequest('public-recipe-edit', { recipe, terms })
            const catalogResponse = await fetch('/api/catalog')
            if (catalogResponse.ok) setPublishedTerms((await catalogResponse.json()).terms ?? emptyTerms)
            setPublicRecipes(current => current.map(item => item.id === recipe.id ? recipe : item))
            if (tab === 'beheer') setAdminRevision(value => value + 1)
            setModal({ kind: 'recipe', id: recipe.id, publicRecipe: recipe })
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Opslaan is niet gelukt.')
          } finally { setSavingPublic(false) }
          return
        }
        if (await save({ type: 'saveRecipe', recipe, terms })) openRecipe(recipe, modal.date)
      }}/>}
      {modal.kind === 'day' && <div className="day-editor">
        <section className="day-attendance"><h3>Mee-eters</h3>
        <p>Vink aan wie er mee-eet.</p>
        <div className="attendance">{state.people.map(person => <label key={person.id} className="check-row">
          <input type="checkbox" checked={diners(state, modal.date).some(item => item.id === person.id)} disabled={busy}
            onChange={event => void save({ type: 'attendance', date: modal.date, id: person.id, present: event.target.checked })}/>
          <span>{person.name}</span><strong>{amount(person.factor, 'portie')}</strong>
        </label>)}</div>
        {!state.people.length && <button className="button" onClick={() => { close(); navigate('huisgenoten') }}>Huisgenoot toevoegen</button>}
        </section>
        <DayMealPicker beforeDone={dayBeforeDone} openRecipe={openRecipe} key={modal.date} date={modal.date} state={state} recipes={recipes} busy={busy} save={save}/>
        {dayMeal && (dayMeal.text || canScheduleRecipe(state, dayMeal.recipeId)) && <details className="day-move"><summary>Planning verplaatsen</summary><form className="form-row" onSubmit={event => {
          event.preventDefault()
          const destination = String(new FormData(event.currentTarget).get('destination') || '')
          if (destination === modal.date) setError('Kies een andere dag.')
          else void moveMeal(modal.date, destination)
        }}>
          <label>Verplaatsen naar<input type="date" name="destination" required/></label>
          <button className="button" disabled={busy}>Maaltijd verplaatsen</button>
        </form></details>}
        <div className="day-done"><button className="button primary" disabled={busy} onClick={async () => { if (!dayBeforeDone.current || await dayBeforeDone.current()) close() }}>Klaar <Icon name="check" size={17}/></button></div>
      </div>}
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
