import { useEffect, useState } from 'react'
import { Icon } from './visuals'

export function Toast({ message }: { message: string }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    setVisible(!!message)
    if (!message) return
    const timer = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(timer)
  }, [message])
  if (!visible || !message) return null
  return <div className="toast" role="status" aria-live="polite" aria-atomic="true">
    <span className="toast-icon"><Icon name="check" size={20}/></span>
    <p>{message}</p>
    <button type="button" className="icon-button" aria-label="Melding sluiten" onClick={() => setVisible(false)}><Icon name="close" size={17}/></button>
  </div>
}
