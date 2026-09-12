import { mount } from 'svelte'
import App from './App.svelte'
import MiniPlayer from './screens/MiniPlayer.svelte'
import './app.css'
import { applyTheme, loadStoredThemeId } from './lib/themes'
import { installCoverRetry } from './lib/cover-retry'

// The mini-player window loads the same renderer bundle with `#mini` — it
// mounts the dumb MiniPlayer view instead of the full app (no PlexState).
const isMini = window.location.hash === '#mini'

// Apply the stored theme before the first paint so the app boots into the
// user's chosen palette without flashing the default.
applyTheme(loadStoredThemeId())

// Before the first cover mounts: broken cover images re-request themselves
// after a network blip instead of staying blank for the session.
installCoverRetry()

const app = mount(isMini ? MiniPlayer : App, { target: document.getElementById('app')! })

if (!isMini) {
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
}

export default app
