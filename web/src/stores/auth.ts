import { defineStore } from 'pinia'
import { apiClient } from '../api/client'

interface CurrentUser {
  id: number
  email: string
}

interface CurrentOrganization {
  id: number
  name: string
}

interface AuthState {
  token: string | null
  user: CurrentUser | null
  organization: CurrentOrganization | null
}

/** Shape of an error response body — see docs/design/F0-api.md §0. */
export interface ApiErrorBody {
  error?: string
  errors?: Record<string, string[]>
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: localStorage.getItem('token'),
    user: null,
    organization: null,
  }),

  getters: {
    isAuthenticated: (state) => !!state.token && !!state.user,
  },

  actions: {
    /**
     * Throws the parsed error body on failure so the caller (LoginView)
     * decides how to render it — the store itself never redirects (SoT
     * F0-foundation.md §3, design decision: keep that in the component so
     * it's easy to test).
     */
    async login(email: string, password: string): Promise<void> {
      const response = await apiClient.post('/api/v1/sessions', { email, password })
      this.token = response.data.token
      this.user = response.data.user
      this.organization = response.data.organization
      localStorage.setItem('token', response.data.token)
    },

    logout(): void {
      this.token = null
      this.user = null
      this.organization = null
      localStorage.removeItem('token')
      // No BE call — JWT is stateless, see docs/design/F0-api.md §6 OQ-3.
    },

    /**
     * Called once on app boot: if a token survived a reload, re-fetch
     * user/organization from the API (never trust stale localStorage data
     * for these — the org name shown in the topbar must be live).
     * Clears the session silently on 401 (expired/invalid token, or the
     * user was deactivated) — the router guard sends the user to /login.
     */
    async hydrate(): Promise<void> {
      if (!this.token) return
      try {
        // skipAuthRedirect: this 401 is already fully handled right here
        // (logout()) plus by the router guard once hydrate() resolves —
        // the interceptor's hard page reload would otherwise race that
        // (code-review finding).
        const response = await apiClient.get('/api/v1/me', { skipAuthRedirect: true })
        this.user = response.data.user
        this.organization = response.data.organization
      } catch {
        this.logout()
      }
    },
  },
})
