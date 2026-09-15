import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'
import { apiClient } from '../../api/client'

vi.mock('../../api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}))

describe('useAuthStore', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts unauthenticated with no token in storage', () => {
    const store = useAuthStore()
    expect(store.isAuthenticated).toBe(false)
  })

  it('login() stores the token, user, and organization on success', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        token: 'jwt-token',
        user: { id: 1, email: 'admin@acme.example' },
        organization: { id: 1, name: 'Acme Inc.' },
      },
    })

    const store = useAuthStore()
    await store.login('admin@acme.example', 'Password123!')

    expect(store.isAuthenticated).toBe(true)
    expect(store.token).toBe('jwt-token')
    expect(store.organization?.name).toBe('Acme Inc.')
    expect(localStorage.getItem('token')).toBe('jwt-token')
  })

  it('login() rejects and leaves the store unauthenticated on failure', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { status: 401, data: { error: 'Email hoặc mật khẩu không đúng.' } },
    })

    const store = useAuthStore()
    await expect(store.login('admin@acme.example', 'wrong')).rejects.toBeDefined()
    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('logout() clears state and localStorage without calling the API', () => {
    localStorage.setItem('token', 'stale-token')
    const store = useAuthStore()
    store.token = 'stale-token'
    store.user = { id: 1, email: 'x@x.com' }

    store.logout()

    expect(store.isAuthenticated).toBe(false)
    expect(store.token).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('hydrate() is a no-op when there is no token', async () => {
    const store = useAuthStore()
    await store.hydrate()
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('hydrate() logs out silently when the stored token is rejected (expired/deactivated)', async () => {
    localStorage.setItem('token', 'stale-token')
    const store = useAuthStore()
    store.token = 'stale-token'
    vi.mocked(apiClient.get).mockRejectedValueOnce({ response: { status: 401 } })

    await store.hydrate()

    expect(store.isAuthenticated).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })
})
