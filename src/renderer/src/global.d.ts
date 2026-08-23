import type { PzApi } from '@shared/api'

declare global {
  interface Window {
    pz: PzApi
  }
}
