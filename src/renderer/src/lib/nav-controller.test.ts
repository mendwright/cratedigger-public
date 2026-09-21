import { describe, it, expect } from 'vitest'
import { NavController } from './nav-controller.svelte'
import { NAV_STACK_CAP, type NavEntity } from './nav-entity'

const album = (rk: string): NavEntity => ({ kind: 'album', ratingKey: rk })

describe('NavController', () => {
  it('pushes frames and reports the top', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.push(album('b'))
    expect(nav.stack).toHaveLength(2)
    expect(nav.top()?.entity).toEqual(album('b'))
  })

  it('suppresses a push that duplicates the current top', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.push(album('a')) // same entity — re-opening the screen you're on
    expect(nav.stack).toHaveLength(1)
    // ...but a non-adjacent repeat is allowed (A → B → A)
    nav.push(album('b'))
    nav.push(album('a'))
    expect(nav.stack.map((f) => f.entity)).toEqual([album('a'), album('b'), album('a')])
  })

  it('evicts the oldest frame once the cap is hit', () => {
    const nav = new NavController()
    for (let i = 0; i < NAV_STACK_CAP + 5; i++) nav.push(album(`a${i}`))
    expect(nav.stack).toHaveLength(NAV_STACK_CAP)
    // oldest five (a0..a4) evicted; a5 is now the base
    expect(nav.stack[0].entity).toEqual(album('a5'))
    expect(nav.top()?.entity).toEqual(album(`a${NAV_STACK_CAP + 4}`))
  })

  it('pop moves the top onto the forward stack; unpop restores it', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.push(album('b'))

    const popped = nav.pop()
    expect(popped?.entity).toEqual(album('b'))
    expect(nav.stack).toHaveLength(1)
    expect(nav.forward).toHaveLength(1)

    const restored = nav.unpop()
    expect(restored?.entity).toEqual(album('b'))
    expect(nav.stack).toHaveLength(2)
    expect(nav.forward).toHaveLength(0)
  })

  it('a fresh push clears the forward (redo) stack', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.push(album('b'))
    nav.pop() // forward = [b]
    expect(nav.forward).toHaveLength(1)
    nav.push(album('c')) // new branch invalidates redo
    expect(nav.forward).toHaveLength(0)
  })

  it('pop and unpop are null on empty stacks', () => {
    const nav = new NavController()
    expect(nav.pop()).toBeNull()
    expect(nav.unpop()).toBeNull()
    expect(nav.top()).toBeNull()
  })

  it('popIfTop only pops a matching top', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.push(album('b'))

    nav.popIfTop(album('a')) // top is b — no-op
    expect(nav.stack).toHaveLength(2)

    nav.popIfTop(album('b')) // matches — pops, without feeding forward
    expect(nav.stack).toHaveLength(1)
    expect(nav.forward).toHaveLength(0)
  })

  it('reset clears both stacks', () => {
    const nav = new NavController()
    nav.push(album('a'))
    nav.pop()
    nav.reset()
    expect(nav.stack).toHaveLength(0)
    expect(nav.forward).toHaveLength(0)
  })
})
