import { nutritionLabels, allergyTags, isAllergyTag } from '../domain/catalog'
import type { NutritionValues } from '../domain/catalog'
import { useState } from 'react'
import { nameKey, ingredientCode } from '../domain/terms'
import type { Tag, Terms } from '../domain/terms'
import { unitChoices } from '../domain/units'
import type { Ingredient, Recipe } from '../domain/catalog'
import { TermPicker } from './term-picker'
import { Icon } from './visuals'

async function resizeRecipeImage(file: File) {
  if (file.size > 12 * 1024 * 1024) throw new Error('Kies een afbeelding van maximaal 12 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const ratio = Math.min(1, 960 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('De afbeelding kon niet worden verwerkt.')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      const image = canvas.toDataURL('image/webp', quality)
      if (image.startsWith('data:image/webp;base64,') && image.length <= 140000) return image
    }
    throw new Error('Kies een kleinere afbeelding.')
  } finally {
    bitmap.close()
  }
}

const createTermId = (kind: string) => kind + '-' +
  Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

export function RecipeEditor({ recipe, busy, publicTerms, privateTerms, onSave, cancel, publicOnly = false }: {
  recipe: Recipe; publicOnly?: boolean; busy: boolean; publicTerms: Terms; privateTerms: Terms
  onSave: (recipe: Recipe, terms: Terms) => void; cancel: () => void
}) {
  const [draft, setDraft] = useState(recipe)
  const [imageError, setImageError] = useState('')
  const [loadingImage, setLoadingImage] = useState(false)
  const [newIngredient, setNewIngredient] = useState('')
  const [unit, setUnit] = useState('')
  const [newIngredients, setNewIngredients] = useState<Ingredient[]>([])
  const [newTags, setNewTags] = useState<Tag[]>(() => recipe.tagIds ? [] : [...new Map(recipe.tags.map(name => [nameKey(name), name])).values()]
    .filter(name => ![...publicTerms.tags, ...privateTerms.tags].some(tag => nameKey(tag.name) === nameKey(name)))
    .map(name => ({ id: createTermId('tag'), name })))
  const [selectedTags, setSelectedTags] = useState(() => recipe.tagIds ?? [...new Set(recipe.tags.flatMap(name => {
    const tag = [...publicTerms.tags, ...privateTerms.tags, ...newTags].find(option => nameKey(option.name) === nameKey(name))
    return tag ? [tag.id] : []
  }))])
  const ingredients = Object.fromEntries([...publicTerms.ingredients, ...privateTerms.ingredients, ...newIngredients].map(item => [item.id, item]))
  const tags = Object.fromEntries([...publicTerms.tags, ...privateTerms.tags, ...newTags].map(item => [item.id, item]))
  const [originalCodes] = useState(() => {
    const entries = Object.values(ingredients)
    const codes = new Map(entries.map(item => [item.id, item.id]))
    const used = new Set(codes.values())
    for (const item of entries) {
      if (!item.code && !/^ingredient-[a-f0-9]{32}$/.test(item.id)) continue
      const base = item.code ?? (ingredientCode(item.name) || 'ingredient')
      let code = base
      for (let suffix = 2; used.has(code); suffix++) code = base + '-' + suffix
      used.add(code)
      codes.set(item.id, code)
    }
    return codes
  })
  const codes = new Map(originalCodes)
  const used = new Set(codes.values())
  for (const item of Object.values(ingredients)) {
    if (codes.has(item.id)) continue
    const base = item.code ?? (ingredientCode(item.name) || 'ingredient')
    let code = base
    for (let suffix = 2; used.has(code); suffix++) code = base + '-' + suffix
    used.add(code)
    codes.set(item.id, code)
  }
  const idsByCode = new Map([...codes].map(([id, code]) => [code, id]))
  const replaceReferences = (step: string, lookup: Map<string, string>) =>
    step.replace(/\{([a-z0-9-]+)(:[^}]+)?\}/g, (_, key, fraction = '') => '{' + (lookup.get(key) ?? key) + fraction + '}')
  const [steps, setSteps] = useState(() => draft.steps.map((text, id) => ({ id, text: replaceReferences(text, codes) })))
  const setField = <K extends keyof Recipe>(key: K, value: Recipe[K]) => setDraft(current => ({ ...current, [key]: value }))
  function addIngredient(ingredient: Ingredient) {
    if (!Object.hasOwn(draft.amounts, ingredient.id)) setField('amounts', { ...draft.amounts, [ingredient.id]: 1 })
    setNewIngredient('')
    setUnit('')
  }
  function selectTag(tag: Tag) {
    if (selectedTags.length < 20 && !selectedTags.includes(tag.id)) setSelectedTags([...selectedTags, tag.id])
  }
  return <form className="recipe-editor" onSubmit={event => {
    event.preventDefault()
    if (loadingImage || newIngredient) return
    onSave({ ...draft, tagIds: selectedTags, tags: selectedTags.map(id => tags[id].name), steps: steps.map(step => replaceReferences(step.text, idsByCode)) }, {
      ingredients: newIngredients.filter(item => Object.hasOwn(draft.amounts, item.id)),
      tags: newTags.filter(item => selectedTags.includes(item.id)),
    })
  }}>
    <label>Receptafbeelding<input type="file" accept="image/jpeg,image/png,image/webp" disabled={loadingImage || busy} onChange={async event => {
      const file = event.target.files?.[0]
      event.currentTarget.value = ''
      if (!file) return
      setImageError('')
      setLoadingImage(true)
      try { setField('image', await resizeRecipeImage(file)) }
      catch (error) { setImageError(error instanceof Error ? error.message : 'De afbeelding kon niet worden geopend.') }
      finally { setLoadingImage(false) }
    }}/></label>
    {draft.image && <><img className="recipe-upload-preview" src={draft.image} alt="Voorbeeld receptafbeelding"/>
      <button type="button" className="button" disabled={loadingImage} onClick={() => setField('image', undefined)}>Afbeelding verwijderen</button></>}
    {imageError && <p className="alert" role="alert">{imageError}</p>}
    <label>Receptnaam<input required maxLength={100} value={draft.title} onChange={event => setField('title', event.target.value)}/></label>
    <label>Ondertitel<input maxLength={160} value={draft.subtitle} onChange={event => setField('subtitle', event.target.value)}/></label>
    <div className="form-row editor-fields">
      <label>Keuken<input required maxLength={80} value={draft.cuisine} onChange={event => setField('cuisine', event.target.value)}/></label>
      <label>Bereidingstijd (minuten)<input type="number" required min={1} max={600} value={draft.minutes || ''} onChange={event => setField('minutes', Number(event.target.value))}/></label>
    </div>
    <label>Omschrijving<textarea required maxLength={1600} rows={3} value={draft.description} onChange={event => setField('description', event.target.value)}/></label>
    <label>Herkomst<select value={draft.source === undefined ? 'unknown' : draft.source === null ? 'original' : 'source'}
      onChange={event => setField('source', event.target.value === 'original' ? null : event.target.value === 'source' ? '' : undefined)}>
      {recipe.source === undefined && <option value="unknown">Niet opgegeven</option>}
      <option value="original">Origineel recept</option>
      <option value="source">Overgenomen of bewerkt uit een bron</option>
    </select></label>
    {typeof draft.source === 'string' && <label>Bronlink<input type="url" required maxLength={2048}
      placeholder="https://…" value={draft.source} onChange={event => setField('source', event.target.value)}/></label>}
    <div className="tags selected-terms">
      {selectedTags.filter(id => !isAllergyTag(tags[id].name)).map(id => <button className="button" key={id} type="button" aria-label={tags[id].name + ' verwijderen'}
        onClick={() => setSelectedTags(selectedTags.filter(tagId => tagId !== id))}>{tags[id].name} <Icon name="close" size={14}/></button>)}
    </div>
    <TermPicker label="Kenmerk zoeken of toevoegen" options={Object.values(tags).filter(tag => !isAllergyTag(tag.name))} maxLength={40}
      describe={tag => publicTerms.tags.some(item => item.id === tag.id) ? 'Publiek' : 'Privé'}
      pick={selectTag} create={publicOnly ? undefined : name => {
        if (selectedTags.length >= 20 || publicTerms.tags.some(tag => isAllergyTag(tag.name) && nameKey(tag.name) === nameKey(name))) return
        const tag = { id: createTermId('tag'), name }
        setNewTags([...newTags, tag])
        selectTag(tag)
      }}/>
    <fieldset className="full-width allergy-fieldset"><legend>Allergie-informatie</legend>
      <small>Vink alleen labels aan die je voor dit recept hebt gecontroleerd.</small>
      <div className="form-row">{allergyTags.map(name => {
        const tag = publicTerms.tags.find(item => item.name === name)
        if (!tag) return null
        const ids = selectedTags.filter(id => tags[id].name === tag.name)
        return <label className="check-row" key={tag.id}>
          <input type="checkbox" checked={ids.length > 0} disabled={!ids.length && selectedTags.length >= 20}
            onChange={event => event.target.checked ? selectTag(tag) : setSelectedTags(selectedTags.filter(id => !ids.includes(id)))}/>{tag.name}
        </label>
      })}</div>
    </fieldset>
    <fieldset className="full-width"><legend>Voedingswaarden per portie</legend>
      <div className="form-row">{(Object.keys(nutritionLabels) as (keyof NutritionValues)[]).map(key => <label key={key}>{key === "kcal" ? "Aantal kilocalorieën (kcal)" : "Aantal gram " + nutritionLabels[key].slice(2)}
        <input type="number" min="0" max="10000" step="any" value={draft.nutrition?.[key] ?? ''} onChange={event => {
          const values = { ...draft.nutrition }
          if (event.target.value === '') delete values[key]
          else values[key] = Number(event.target.value)
          setField('nutrition', Object.keys(values).length ? values : undefined)
        }}/>
      </label>)}</div>
    </fieldset>
    <h3>Ingrediënten voor één portie</h3>
    {Object.entries(draft.amounts).map(([id, value]) => <div className="ingredient-edit" key={id}>
      <span>{ingredients[id].name}</span>
      <input aria-label={'Hoeveelheid ' + ingredients[id].name} type="number" required min="0.000001" max={10000} step="any" value={value || ''}
        onChange={event => setField('amounts', { ...draft.amounts, [id]: Number(event.target.value) })}/>
      <small>{ingredients[id].unit}</small>
      <button className="icon-button" type="button" aria-label={ingredients[id].name + ' verwijderen'} onClick={() => {
        const amounts = { ...draft.amounts }
        delete amounts[id]
        setField('amounts', amounts)
        setSteps(current => current.map(step => ({
          ...step, text: step.text.replace(/\{([^}:]+)(?::[^}]+)?\}/g, (token, reference) => reference === codes.get(id) ? ingredients[id].name.toLocaleLowerCase('nl') : token),
        })))
      }}><Icon name="close" size={16}/></button>
    </div>)}
    <TermPicker label="Ingrediënt zoeken of toevoegen" options={Object.values(ingredients)} maxLength={80}
      describe={ingredient => [ingredient.unit, publicTerms.ingredients.some(item => item.id === ingredient.id) ? 'Publiek' : 'Privé'].join(' · ')}
      pick={addIngredient} create={publicOnly ? undefined : name => { setNewIngredient(name); setUnit('') }}/>
    {newIngredient && <div className="form-row editor-add">
      <label>Eenheid voor {newIngredient}<select value={unit} onChange={event => setUnit(event.target.value)}>
        <option value="">Kies een eenheid</option>
        {unitChoices.map(choice => <option key={choice.id} value={choice.id}>{choice.label} ({choice.id})</option>)}
      </select></label>
      <button className="button" type="button" disabled={!unit} onClick={() => {
        const ingredient = { id: createTermId('ingredient'), name: newIngredient, unit, group: 'Overige ingrediënten' }
        setNewIngredients([...newIngredients, ingredient])
        addIngredient(ingredient)
      }}><Icon name="plus" size={16}/> Privé-ingrediënt toevoegen</button>
      <button className="button text" type="button" onClick={() => { setNewIngredient(''); setUnit('') }}>Annuleren</button>
    </div>}
    <h3>Bereiding</h3>
    <small>Koppel een ingrediënt aan een stap om de hoeveelheid mee te laten schalen.</small>
    {steps.map((step, index) => <div className="step-edit" key={step.id}>
      <label>Stap {index + 1}<textarea required maxLength={600} rows={2} value={step.text}
        onChange={event => setSteps(current => current.map(item => item.id === step.id ? { ...item, text: event.target.value } : item))}/></label>
      <div className="form-row">
        <select aria-label={'Ingrediënt invoegen in stap ' + (index + 1)} value="" onChange={event => {
          const id = event.target.value
          const field = event.currentTarget.closest('.step-edit')?.querySelector('textarea')
          const start = field?.selectionStart ?? step.text.length
          const end = field?.selectionEnd ?? start
          const text = step.text.slice(0, start) + '{' + codes.get(id) + '}' + step.text.slice(end)
          setSteps(current => current.map(item => item.id === step.id ? { ...item, text } : item))
        }}>
          <option value="" disabled>Ingrediënt invoegen…</option>
          {Object.keys(draft.amounts).map(id => <option key={id} value={id}>{ingredients[id].name}</option>)}
        </select>
        <button type="button" className="button text danger" disabled={steps.length === 1} onClick={() => setSteps(current => current.filter(item => item.id !== step.id))}>Verwijder stap</button>
      </div>
    </div>)}
    <button type="button" className="button" disabled={steps.length >= 30} onClick={() => setSteps(current => [...current, { id: Math.max(...current.map(step => step.id)) + 1, text: '' }])}><Icon name="plus" size={16}/> Stap toevoegen</button>
    <div className="form-row dialog-footer">
      <button type="submit" className="button primary" disabled={busy || loadingImage || !!newIngredient || !Object.keys(draft.amounts).length}>Recept opslaan</button>
      <button type="button" className="button" onClick={cancel}>Annuleren</button>
    </div>
  </form>
}
