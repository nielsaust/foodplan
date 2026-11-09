import { useState } from 'react'
import { ingredientById, ingredients } from '../domain/catalog'
import type { Recipe } from '../domain/catalog'
import { Icon } from './visuals'

export function RecipeEditor({ recipe, busy, onSave, cancel }: {
  recipe: Recipe; busy: boolean; onSave: (recipe: Recipe) => void; cancel: () => void
}) {
  const [draft, setDraft] = useState(recipe)
  const [ingredient, setIngredient] = useState('')
  const [steps, setSteps] = useState(() => draft.steps.map((text, id) => ({ id, text })))
  const setField = <K extends keyof Recipe>(key: K, value: Recipe[K]) => setDraft(current => ({ ...current, [key]: value }))
  const addIngredient = () => {
    if (!ingredient) return
    setField('amounts', { ...draft.amounts, [ingredient]: 1 })
    setIngredient('')
  }
  return <form className="recipe-editor" onSubmit={event => {
    event.preventDefault()
    onSave({ ...draft, tags: draft.tags.map(tag => tag.trim()).filter(Boolean), steps: steps.map(step => step.text) })
  }}>
    <label>Receptnaam<input required maxLength={100} value={draft.title} onChange={event => setField('title', event.target.value)}/></label>
    <label>Ondertitel<input maxLength={160} value={draft.subtitle} onChange={event => setField('subtitle', event.target.value)}/></label>
    <div className="form-row editor-fields">
      <label>Keuken<input required maxLength={80} value={draft.cuisine} onChange={event => setField('cuisine', event.target.value)}/></label>
      <label>Bereidingstijd (minuten)<input type="number" required min={1} max={600} value={draft.minutes || ''} onChange={event => setField('minutes', Number(event.target.value))}/></label>
    </div>
    <label>Omschrijving<textarea required maxLength={1600} rows={3} value={draft.description} onChange={event => setField('description', event.target.value)}/></label>
    <label>Kenmerken (gescheiden door komma’s)<input value={draft.tags.join(',')} onChange={event => setField('tags', event.target.value.split(','))}/></label>
    <h3>Ingrediënten voor één portie</h3>
    {Object.entries(draft.amounts).map(([id, value]) => <div className="ingredient-edit" key={id}>
      <span>{ingredientById[id].name}</span>
      <input aria-label={'Hoeveelheid ' + ingredientById[id].name} type="number" required min="0.000001" max={10000} step="any" value={value || ''}
        onChange={event => setField('amounts', { ...draft.amounts, [id]: Number(event.target.value) })}/>
      <small>{ingredientById[id].unit}</small>
      <button className="icon-button" type="button" aria-label={ingredientById[id].name + ' verwijderen'} onClick={() => {
        const amounts = { ...draft.amounts }
        delete amounts[id]
        setField('amounts', amounts)
        setSteps(current => current.map(step => ({
          ...step, text: step.text.replace(/\{([^}:]+)(?::[^}]+)?\}/g, (token, reference) => reference === id ? ingredientById[id].name.toLocaleLowerCase('nl') : token),
        })))
      }}><Icon name="close" size={16}/></button>
    </div>)}
    <div className="form-row editor-add">
      <label>Ingrediënt kiezen<select value={ingredient} onChange={event => setIngredient(event.target.value)}>
        <option value="">Kies uit de ingrediëntenlijst</option>
        {ingredients.filter(item => !Object.hasOwn(draft.amounts, item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <button className="button" type="button" disabled={!ingredient} onClick={addIngredient}><Icon name="plus" size={16}/> Toevoegen</button>
    </div>
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
          const text = step.text.slice(0, start) + '{' + id + '}' + step.text.slice(end)
          setSteps(current => current.map(item => item.id === step.id ? { ...item, text } : item))
        }}>
          <option value="" disabled>Ingrediënt invoegen…</option>
          {Object.keys(draft.amounts).map(id => <option key={id} value={id}>{ingredientById[id].name}</option>)}
        </select>
        <button type="button" className="button text danger" disabled={steps.length === 1} onClick={() => setSteps(current => current.filter(item => item.id !== step.id))}>Verwijder stap</button>
      </div>
    </div>)}
    <button type="button" className="button" disabled={steps.length >= 30} onClick={() => setSteps(current => [...current, { id: Math.max(...current.map(step => step.id)) + 1, text: '' }])}><Icon name="plus" size={16}/> Stap toevoegen</button>
    <div className="form-row dialog-footer">
      <button type="submit" className="button primary" disabled={busy || !Object.keys(draft.amounts).length}>Recept opslaan</button>
      <button type="button" className="button" onClick={cancel}>Annuleren</button>
    </div>
  </form>
}
