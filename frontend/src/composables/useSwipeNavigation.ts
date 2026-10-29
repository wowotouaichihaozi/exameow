import { nextTick, ref } from 'vue'

type Direction = 'next' | 'prev'

export interface SwipeNavOptions {
  threshold?: number
  canNavigate?: (direction: Direction) => boolean
  disabled?: () => boolean
}

function isGestureBlockedEl(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('input, textarea, select, a, button, [contenteditable="true"]') !== null
}

/** A direction-locked pager: follow the finger, preview the neighbor, then settle. */
export function useSwipeNavigation(
  onNavigate: (direction: Direction) => void,
  options: SwipeNavOptions = {},
) {
  const slideOffset = ref(0)
  const transitioning = ref(false)
  const dragging = ref(false)
  const settling = ref(false)

  let activeElement: HTMLElement | null = null
  let pointerId: number | null = null
  let touchId: number | null = null
  let startX = 0
  let startY = 0
  let lastX = 0
  let lastTime = 0
  let velocity = 0
  let axis: 'horizontal' | 'vertical' | null = null
  let suppressClick = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let clickTimer: ReturnType<typeof setTimeout> | null = null

  const canNavigate = (direction: Direction) => options.canNavigate?.(direction) ?? true
  const isDisabled = () => options.disabled?.() ?? false
  const pageWidth = () => Math.max(activeElement?.clientWidth ?? 0, 1)

  function releasePointer() {
    const releasedId = pointerId
    pointerId = null
    touchId = null
    axis = null
    dragging.value = false
    if (releasedId !== null && activeElement?.hasPointerCapture(releasedId)) {
      activeElement.releasePointerCapture(releasedId)
    }
  }

  function cancel() {
    if (settleTimer !== null) clearTimeout(settleTimer)
    if (clickTimer !== null) clearTimeout(clickTimer)
    settleTimer = null
    clickTimer = null
    releasePointer()
    transitioning.value = false
    settling.value = false
    slideOffset.value = 0
    suppressClick = false
  }

  function resetClickSuppression() {
    if (clickTimer !== null) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      suppressClick = false
      clickTimer = null
    }, 0)
  }

  function settle(direction?: Direction) {
    releasePointer()
    transitioning.value = true
    settling.value = true
    slideOffset.value = direction ? (direction === 'next' ? -pageWidth() : pageWidth()) : 0
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 200
    settleTimer = setTimeout(async () => {
      settleTimer = null
      if (direction && !isDisabled() && canNavigate(direction)) onNavigate(direction)
      // Render the new active page before resetting the track, so it never flashes back.
      await nextTick()
      transitioning.value = false
      slideOffset.value = 0
      settling.value = false
    }, duration)
    resetClickSuppression()
  }

  function startGesture(x: number, y: number, time: number) {
    startX = lastX = x
    startY = y
    lastTime = time
    velocity = 0
    axis = null
    suppressClick = false
    transitioning.value = false
  }

  function moveGesture(x: number, y: number, time: number): boolean {
    if (isDisabled()) {
      cancel()
      return false
    }
    const dx = x - startX
    const dy = y - startY
    if (!axis && Math.hypot(dx, dy) >= 8) {
      axis = Math.abs(dx) > Math.abs(dy) * 1.3 ? 'horizontal' : 'vertical'
      if (axis === 'horizontal') {
        dragging.value = true
        if (pointerId !== null) activeElement?.setPointerCapture(pointerId)
      }
    }
    if (axis !== 'horizontal') return false

    suppressClick = true
    const elapsed = time - lastTime
    if (elapsed > 0) velocity = (x - lastX) / elapsed
    lastX = x
    lastTime = time
    const direction = dx < 0 ? 'next' : 'prev'
    // Normal pages follow 1:1. Resistance is only used at the ends of the bank.
    slideOffset.value = canNavigate(direction)
      ? Math.max(-pageWidth(), Math.min(pageWidth(), dx))
      : Math.sign(dx) * Math.min(56, Math.abs(dx) * 0.22)
    return true
  }

  function finishGesture(x: number, time: number) {
    if (axis !== 'horizontal') {
      releasePointer()
      return
    }
    const dx = x - startX
    const direction = dx < 0 ? 'next' : 'prev'
    const distance = Math.abs(dx)
    const threshold = options.threshold ?? Math.max(56, Math.min(110, pageWidth() * 0.25))
    const recentVelocity = time - lastTime < 100 ? velocity : 0
    const flick = distance >= 36 && Math.abs(recentVelocity) >= 0.45
      && Math.sign(recentVelocity) === Math.sign(dx)
    settle(!isDisabled() && canNavigate(direction) && (distance >= threshold || flick)
      ? direction
      : undefined)
  }

  function handlePointerDown(event: PointerEvent) {
    // Touch has its own non-passive move listener. A WebView's pointercancel
    // must not terminate the still-active touch stream.
    if (event.pointerType === 'touch' || !event.isPrimary || event.button !== 0
      || pointerId !== null || touchId !== null || settling.value
      || isDisabled() || isGestureBlockedEl(event.target)) return
    pointerId = event.pointerId
    startGesture(event.clientX, event.clientY, event.timeStamp)
  }

  function handlePointerMove(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    if (moveGesture(event.clientX, event.clientY, event.timeStamp)) event.preventDefault()
  }

  function handlePointerUp(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    finishGesture(event.clientX, event.timeStamp)
  }

  function handlePointerCancel(event: PointerEvent) {
    if (pointerId !== event.pointerId) return
    if (axis === 'horizontal') settle()
    else releasePointer()
  }

  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length !== 1) {
      if (touchId !== null) cancel()
      return
    }
    if (pointerId !== null || touchId !== null || settling.value
      || isDisabled() || isGestureBlockedEl(event.target)) return
    const touch = event.touches[0]!
    touchId = touch.identifier
    startGesture(touch.clientX, touch.clientY, event.timeStamp)
  }

  function handleTouchMove(event: TouchEvent) {
    if (touchId === null) return
    if (event.touches.length !== 1) {
      cancel()
      return
    }
    const touch = Array.from(event.touches).find(item => item.identifier === touchId)
    if (!touch) return
    if (moveGesture(touch.clientX, touch.clientY, event.timeStamp) && event.cancelable) {
      // Once horizontal intent is locked, keep scrolling from taking over.
      // Vertical gestures remain native, as do multi-finger zoom gestures.
      event.preventDefault()
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    if (touchId === null) return
    const touch = Array.from(event.changedTouches).find(item => item.identifier === touchId)
    if (!touch) return
    if (axis === 'horizontal' && event.cancelable) event.preventDefault()
    finishGesture(touch.clientX, event.timeStamp)
  }

  function handleTouchCancel() {
    if (touchId === null) return
    if (axis === 'horizontal') settle()
    else releasePointer()
  }

  function handleClickCapture(event: MouseEvent) {
    if (!suppressClick) return
    event.preventDefault()
    event.stopPropagation()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isDisabled() || settling.value || isGestureBlockedEl(event.target)) return
    const direction = event.key === 'ArrowRight' ? 'next' : event.key === 'ArrowLeft' ? 'prev' : null
    if (!direction || !canNavigate(direction)) return
    event.preventDefault()
    onNavigate(direction)
  }

  function attach(element: HTMLElement) {
    detach()
    activeElement = element
    element.style.touchAction = 'pan-y pinch-zoom'
    element.addEventListener('pointerdown', handlePointerDown)
    element.addEventListener('pointermove', handlePointerMove)
    element.addEventListener('pointerup', handlePointerUp)
    element.addEventListener('pointercancel', handlePointerCancel)
    element.addEventListener('lostpointercapture', handlePointerCancel)
    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd, { passive: false })
    element.addEventListener('touchcancel', handleTouchCancel)
    element.addEventListener('click', handleClickCapture, true)
    window.addEventListener('keydown', handleKeydown)
  }

  function detach(element?: HTMLElement) {
    const target = element ?? activeElement
    cancel()
    if (!target) return
    target.removeEventListener('pointerdown', handlePointerDown)
    target.removeEventListener('pointermove', handlePointerMove)
    target.removeEventListener('pointerup', handlePointerUp)
    target.removeEventListener('pointercancel', handlePointerCancel)
    target.removeEventListener('lostpointercapture', handlePointerCancel)
    target.removeEventListener('touchstart', handleTouchStart)
    target.removeEventListener('touchmove', handleTouchMove)
    target.removeEventListener('touchend', handleTouchEnd)
    target.removeEventListener('touchcancel', handleTouchCancel)
    target.removeEventListener('click', handleClickCapture, true)
    target.style.touchAction = ''
    window.removeEventListener('keydown', handleKeydown)
    if (activeElement === target) activeElement = null
  }

  return { slideOffset, transitioning, dragging, settling, cancel, attach, detach }
}
