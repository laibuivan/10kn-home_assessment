import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import LoginView from '../LoginView.vue'
import { apiClient } from '../../api/client'

vi.mock('../../api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('LoginView', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders the login form', () => {
    const wrapper = mount(LoginView)
    expect(wrapper.find('#email').exists()).toBe(true)
    expect(wrapper.find('#password').exists()).toBe(true)
    expect(wrapper.find('[data-testid=login-submit]').exists()).toBe(true)
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolveLogin!: (v: unknown) => void
    vi.mocked(apiClient.post).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = resolve
      }),
    )

    const wrapper = mount(LoginView)
    await wrapper.find('#email').setValue('admin@acme.example')
    await wrapper.find('#password').setValue('Password123!')
    await wrapper.find('form').trigger('submit')

    expect(wrapper.find('[data-testid=login-submit]').attributes('disabled')).toBeDefined()

    resolveLogin({
      data: { token: 't', user: { id: 1, email: 'admin@acme.example' }, organization: { id: 1, name: 'Acme Inc.' } },
    })
    await flushPromises()
  })

  it('shows the generic error banner on a failed login and does not navigate away', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      response: { status: 401, data: { error: 'Email hoặc mật khẩu không đúng.' } },
    })

    const wrapper = mount(LoginView)
    await wrapper.find('#email').setValue('admin@acme.example')
    await wrapper.find('#password').setValue('wrong')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('[data-testid=login-error]').text()).toContain('Email hoặc mật khẩu không đúng.')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('navigates to /devices on successful login', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { token: 't', user: { id: 1, email: 'admin@acme.example' }, organization: { id: 1, name: 'Acme Inc.' } },
    })

    const wrapper = mount(LoginView)
    await wrapper.find('#email').setValue('admin@acme.example')
    await wrapper.find('#password').setValue('Password123!')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(pushMock).toHaveBeenCalledWith('/devices')
  })
})
