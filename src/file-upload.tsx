import { useId, useRef, useState } from 'react'
import type { ComponentProps, Ref } from 'react'
import { Icon } from './visuals'

type Props = Omit<ComponentProps<'input'>, 'type' | 'ref'> & { ref?: Ref<HTMLInputElement> }
export function FileUpload({ ref, onChange, disabled, accept, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')
  const hintId = useId()
  return <span className={'file-upload' + (dragging ? ' is-dragging' : '') + (disabled ? ' is-disabled' : '')}
    onDragOver={event => { event.preventDefault(); if (!disabled) { setDragging(true); event.dataTransfer.dropEffect = 'copy' } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
    onDrop={event => {
      event.preventDefault()
      setDragging(false)
      if (disabled || !input.current) return
      const files = event.dataTransfer.files
      if (files.length !== 1) { setError('Kies één bestand tegelijk.'); return }
      const file = files[0]
      const allowed = !accept || accept.split(',').some(value => {
        const rule = value.trim().toLowerCase()
        return rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : rule.endsWith('/*') ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule
      })
      if (!allowed) { setError('Dit bestandstype wordt niet ondersteund.'); return }
      input.current.files = files
      input.current.dispatchEvent(new Event('change', { bubbles: true }))
    }}>
    <input {...props} type="file" accept={accept} disabled={disabled} aria-describedby={hintId} ref={node => {
      input.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }} onChange={event => {
      setFilename(event.target.files?.[0]?.name ?? '')
      setError('')
      onChange?.(event)
    }}/>
    <span className="file-upload-icon"><Icon name="upload" size={25}/></span>
    <span className="file-upload-copy"><strong>{dragging ? 'Laat los om te kiezen' : filename || 'Kies een bestand'}</strong><small id={hintId}>{filename ? 'Klik of sleep om te vervangen' : 'Klik om te kiezen of sleep je bestand hierheen'}</small></span>
    <span className="file-upload-action" aria-hidden="true">Bladeren</span>
    {error && <span className="file-upload-error" role="alert">{error}</span>}
  </span>
}
