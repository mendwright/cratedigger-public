import { entityKey, NAV_STACK_CAP, type NavEntity, type NavFrame } from './nav-entity'

/**
 * The back/forward navigation stack, extracted from PlexState as a pure,
 * dependency-free data structure. Owns only the two frame stacks and the
 * mechanics over them — consecutive-duplicate suppression, the
 * {@link NAV_STACK_CAP} ring eviction, and the forward stack that a `pop`
 * feeds and a fresh `push` clears.
 *
 * It deliberately knows nothing about *rendering* a frame: PlexState's
 * `goBack`/`goForward`/`restoreFrame` drive the actual screen restore and call
 * these mechanics for the bookkeeping. That split keeps the (very testable)
 * stack logic away from the view dispatch.
 */
export class NavController {
  stack = $state<NavFrame[]>([])
  forward = $state<NavFrame[]>([])

  /** The current top frame, or null when the stack is empty. */
  top(): NavFrame | null {
    return this.stack.at(-1) ?? null
  }

  /**
   * Push a new entity frame. No-ops when it would duplicate the current top
   * (so re-opening the screen you're already on doesn't stack), evicts the
   * oldest frame once the stack hits the cap, and clears the forward stack
   * (a new branch invalidates any redo history).
   */
  push(entity: NavEntity): void {
    const key = entityKey(entity)
    const top = this.stack.at(-1)
    if (top && entityKey(top.entity) === key) return
    const frame: NavFrame = { entity, scrollY: 0, pushedAt: Date.now() }
    this.stack =
      this.stack.length >= NAV_STACK_CAP
        ? [...this.stack.slice(1), frame]
        : [...this.stack, frame]
    this.forward = []
  }

  /** Pop the top frame onto the forward stack and return it. */
  pop(): NavFrame | null {
    if (this.stack.length === 0) return null
    const popped = this.stack.at(-1)!
    this.stack = this.stack.slice(0, -1)
    this.forward = [...this.forward, popped]
    return popped
  }

  /** Move the most-recently-popped frame back onto the stack (redo). */
  unpop(): NavFrame | null {
    if (this.forward.length === 0) return null
    const item = this.forward.at(-1)!
    this.forward = this.forward.slice(0, -1)
    this.stack = [...this.stack, item]
    return item
  }

  reset(): void {
    this.stack = []
    this.forward = []
  }

  /**
   * Drop the top frame *only* if it matches the given entity — used when a
   * screen closes itself and wants to leave the stack consistent without
   * disturbing an unrelated top.
   */
  popIfTop(entity: NavEntity): void {
    const top = this.stack.at(-1)
    if (!top) return
    if (entityKey(top.entity) !== entityKey(entity)) return
    this.stack = this.stack.slice(0, -1)
  }
}
