import { useEffect, useId, useRef, useState } from 'react'
import { nameKey } from '../domain/terms'

export function TermPicker<T extends { id: string; name: string }>({ label, options, describe, pick, create, maxLength }: {
  label: string
  options: T[]
  describe: (option: T) => string
  pick: (option: T) => void
  create: (name: string) => void
  maxLength: number
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const current = useRef<HTMLLIElement>(null)
  const name = query.trim()
  const term = nameKey(name)
  const ranked = options.filter(option => nameKey(option.name).includes(term))
    .sort((a, b) => Number(nameKey(b.name).startsWith(term)) - Number(nameKey(a.name).startsWith(term)) || a.name.localeCompare(b.name, 'nl'))
  const matches = ranked.slice(0, 12)
  const canCreate = !!term && !ranked.some(option => nameKey(option.name) === term)
  const size = matches.length + Number(canCreate)
  const visible = open && size > 0
  useEffect(() => { current.current?.scrollIntoView({ block: 'nearest' }) }, [active])
  function select(index: number) {
    if (index < 0 || index >= size) return
    if (index < matches.length) pick(matches[index])
    else create(name)
    setQuery('')
    setOpen(false)
    setActive(-1)
  }
  return <div className="term-picker">
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={visible}
      aria-controls={visible ? id + '-options' : undefined} aria-activedescendant={visible && active >= 0 ? id + '-option-' + active : undefined}
      autoComplete="off" placeholder="Typ om te zoeken…" maxLength={maxLength} value={query}
      onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setActive(-1) }}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!size) return
          event.preventDefault()
          setOpen(true)
          setActive(index => event.key === 'ArrowDown' ? (index + 1) % size : index <= 0 ? size - 1 : index - 1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (visible) select(active >= 0 ? active : 0)
          else setOpen(true)
        } else if (event.key === 'Escape' && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          setActive(-1)
        }
      }}/>
    {visible && <ul role="listbox" id={id + '-options'} className="term-options" aria-label={label}>
      {[...matches.map(option => ({ key: option.id, name: option.name, detail: describe(option) })),
        ...(canCreate ? [{ key: 'new', name: '‘' + name + '’ toevoegen', detail: 'Privé' }] : [])].map((option, index) =>
        <li key={option.key} id={id + '-option-' + index} role="option" aria-selected={active === index}
          ref={active === index ? current : undefined} onMouseDown={event => event.preventDefault()} onClick={() => select(index)}>
          <span>{option.name}</span><small>{option.detail}</small>
        </li>)}
    </ul>}
  </div>
}
