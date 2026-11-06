import type { CratediggerApi } from './index'

declare global {
  interface Window {
    cratedigger: CratediggerApi
  }
}
