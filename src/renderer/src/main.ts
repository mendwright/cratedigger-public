import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { applyTheme, loadStoredThemeId } from './lib/themes'

// Apply the stored theme before the first paint so the app boots into the
// user's chosen palette without flashing the default.
applyTheme(loadStoredThemeId())

const app = mount(App, { target: document.getElementById('app')! })

window.addEventListener('dblclick', (e) => {
  let el = e.target as HTMLElement | null
  while (el) {
    const region = getComputedStyle(el).getPropertyValue('-webkit-app-region').trim()
    if (region === 'no-drag') return
    if (region === 'drag') {
      void window.cratedigger.win.toggleFullScreen()
      return
    }
    el = el.parentElement
  }
})

export default app
