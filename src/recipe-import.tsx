import { useEffect, useState } from 'react'
import { recipeImportInstructions } from '../domain/recipe-import'
import { Icon } from './visuals'

export function RecipeImport() {
  const [link, setLink] = useState<{ url: string; expiresAt: string }>()
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const expired = !!link && now >= Date.parse(link.expiresAt)
  const instruction = link ? recipeImportInstructions(link.url, link.expiresAt) : ''
  return <details className="panel people-panel recipe-import">
    <summary>Recept toevoegen met Claude of Codex</summary>
    <div className="recipe-import-content">
    <p className="recipe-import-intro">Geef Claude of Codex een receptlink of omschrijving. Je agent werkt het recept uit en voegt het toe aan de privérecepten van je huishouden.</p>
    <ol className="recipe-import-steps">
      <li><strong>Kopieer de instructie</strong><span>Maak hieronder een tijdelijke instructie en kopieer die.</span></li>
      <li><strong>Geef je recept mee</strong><span>Plak de instructie in Claude of Codex, samen met een receptlink of omschrijving.</span></li>
      <li><strong>Laat je agent het toevoegen</strong><span>Beantwoord eventuele vervolgvragen. Het recept verschijnt daarna automatisch bij je privérecepten.</span></li>
    </ol>
    <div className="recipe-import-notice"><Icon name="clock"/><p><strong>15 minuten geldig · één recept</strong><span>Deel de instructie alleen met je agent. Een nieuwe instructie maakt je vorige link ongeldig.</span></p></div>
    <div className="recipe-import-actions">
    <button className="button primary" disabled={busy} onClick={async () => {
      setBusy(true)
      setError('')
      setCopied(false)
      try {
        const response = await fetch('/api/recipe-import-links', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        setLink({ url: new URL(result.path, window.location.origin).href, expiresAt: result.expiresAt })
        setNow(Date.now())
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Instructie maken is niet gelukt.')
      } finally { setBusy(false) }
    }}>{busy ? 'Instructie maken…' : link ? 'Nieuwe instructie maken' : 'Tijdelijke instructie maken'}</button>
    </div>
    {link && <>
      <div className={'recipe-import-validity' + (expired ? ' is-expired' : '')} role="status"><Icon name="clock"/><p>{expired ? <>Deze link is verlopen.<span>Maak een nieuwe instructie om verder te gaan.</span></> : <>Geldig tot <strong><time dateTime={link.expiresAt}>{new Date(link.expiresAt).toLocaleString('nl-NL', { dateStyle: 'long', timeStyle: 'long', timeZone: 'Europe/Amsterdam' })}</time></strong><span>Tijdzone: Europe/Amsterdam · vervalt ook zodra één recept is toegevoegd.</span></>}</p></div>
      <section className="recipe-import-instruction" aria-label="Instructie voor je agent">
      <div className="recipe-import-instruction-heading"><div><h3>Instructie voor je agent</h3><p>Kopieer de volledige tekst en voeg je recept toe.</p></div>
      <button className="button" disabled={expired || busy} onClick={async () => {
        setError('')
        try {
          await navigator.clipboard.writeText(instruction)
          setCopied(true)
        } catch {
          setError('Kopiëren is niet gelukt. Selecteer en kopieer de tekst in het veld hierboven.')
        }
      }}><Icon name={copied ? 'check' : 'copy'} size={17}/>{copied ? 'Instructie gekopieerd' : 'Kopieer instructie'}</button>
      </div>
      <textarea aria-label="Volledige agentinstructie" readOnly rows={12} value={instruction} onFocus={event => event.currentTarget.select()}/>
      </section>
      <p className="recipe-import-hint">Meer tijd nodig? Maak een nieuwe instructie en geef die aan je agent.</p>
    </>}
    {error && <p className="alert" role="alert">{error}</p>}
    </div>
  </details>
}
