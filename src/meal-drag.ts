import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

type Drag = { from: string; to?: string }

export function useMealDrag(move: (from: string, to: string) => void) {
  const [drag, setDrag] = useState<Drag>()
  const gesture = useRef<{ timer: number; pointer: number; x: number; y: number; held: boolean } | undefined>(undefined)
  const suppressClick = useRef(false)
  function targetDate(event: PointerEvent) {
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-meal-date]')
    if (!row) return
    const bounds = row.getBoundingClientRect()
    if (row.dataset.occupied && event.clientY > bounds.top + bounds.height / 2) {
      return (row.nextElementSibling as HTMLElement | null)?.dataset.mealDate ?? row.dataset.after
    }
    return row.dataset.mealDate
  }

  function clear() {
    window.clearTimeout(gesture.current?.timer)
    gesture.current = undefined
    setDrag(undefined)
  }

  useEffect(() => () => window.clearTimeout(gesture.current?.timer), [])

  function handlers(from: string) {
    return {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (!event.isPrimary || event.button !== 0) return
        const { clientX: x, clientY: y, pointerId: pointer, target } = event
        suppressClick.current = false
        clear()
        if (target instanceof Element) target.setPointerCapture(pointer)
        const timer = window.setTimeout(() => {
          if (!gesture.current) return
          gesture.current.held = true
          suppressClick.current = true
          setDrag({ from, to: from })
        }, 350)
        gesture.current = { timer, pointer, x, y, held: false }
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = gesture.current
        if (current?.pointer !== event.pointerId) return
        if (current.held) setDrag({ from, to: targetDate(event) })
        else if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) {
          suppressClick.current = true
          clear()
        }
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (gesture.current?.pointer !== event.pointerId) return
        const to = gesture.current.held && targetDate(event)
        clear()
        if (to && to !== from) move(from, to)
      },
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onContextMenu: (event: MouseEvent) => event.preventDefault(),
      onClickCapture(event: MouseEvent) {
        if (event.detail !== 0 && suppressClick.current) {
          event.preventDefault()
          event.stopPropagation()
        }
        suppressClick.current = false
      },
    }
  }

  return { drag, handlers }
}
