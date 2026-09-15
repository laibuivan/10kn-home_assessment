import axios from 'axios'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Opt this request out of the global 401 -> hard redirect (see below). */
    skipAuthRedirect?: boolean
  }
}

/**
 * Shared axios instance — see docs/design/F0-frontend.md §3.
 *
 * Reads/clears the token via localStorage directly (not the Pinia auth
 * store) to avoid a circular import: the store itself calls into this
 * client to hit the API.
 */
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3010',
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const skipAuthRedirect = error.config?.skipAuthRedirect
    if (status === 401 && !skipAuthRedirect && window.location.pathname !== '/login') {
      // Session no longer valid (expired token, or the user was
      // deactivated mid-session — SoT F0-foundation.md §5.2 A6). Drop the
      // stale token and send the user back to login; LoginView itself
      // handles its own 401s locally so this never fires mid-login-attempt.
      // `skipAuthRedirect` opts a request out of this (e.g. the boot-time
      // hydrate() call in stores/auth.ts) — that caller already handles its
      // own 401 via logout() + the router guard's client-side redirect, so
      // this hard `window.location.assign` would otherwise race it: a full
      // page reload firing at the same time Vue is mid-mount.
      localStorage.removeItem('token')
      window.location.assign('/login')
    }
    return Promise.reject(error)
  },
)
