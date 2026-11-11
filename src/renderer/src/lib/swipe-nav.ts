interface SwipeNavHandlers {
  onBack: () => void
  onForward: () => void
}

const SWIPE_TRIGGER_PX = 90
const COOLDOWN_MS = 500
const IDLE_RESET_MS = 180

/**
 * True when the event target sits inside an element that scrolls
 * horizontally (e.g. the discography strip). Those gestures are for the
 * scroller — never treat them as nav swipes, even at the scroll edges.
 */
function insideHorizontalScroller(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== document.body) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const { overflowX } = getComputedStyle(node)
      if (overflowX === 'auto' || overflowX === 'scroll') return true
    }
    node = node.parentElement
  }
  return false
}

export function installSwipeNav(handlers: SwipeNavHandlers): () => void {
  let accumX = 0
  let lastEventAt = 0
  let lockedUntil = 0

  function onWheel(e: WheelEvent): void {
    const now = performance.now()
    if (now < lockedUntil) return

    const absX = Math.abs(e.deltaX)
    const absY = Math.abs(e.deltaY)
    // Only consider events that are meaningfully horizontal.
    if (absX < 6 || absX < absY * 1.2) {
      if (now - lastEventAt > IDLE_RESET_MS) accumX = 0
      return
    }

    if (insideHorizontalScroller(e.target)) {
      accumX = 0
      return
    }

    if (now - lastEventAt > IDLE_RESET_MS) accumX = 0
    lastEventAt = now
    accumX += e.deltaX

    if (accumX <= -SWIPE_TRIGGER_PX) {
      handlers.onBack()
      accumX = 0
      lockedUntil = now + COOLDOWN_MS
    } else if (accumX >= SWIPE_TRIGGER_PX) {
      handlers.onForward()
      accumX = 0
      lockedUntil = now + COOLDOWN_MS
    }
  }

  window.addEventListener('wheel', onWheel, { passive: true })
  return () => window.removeEventListener('wheel', onWheel)
}
