/** Shape of an error response body — see docs/design/F0-api.md §0. */
export interface ApiErrorBody {
  error?: string
  errors?: Record<string, string[]>
}

interface ErrorWithResponse {
  response?: { data?: ApiErrorBody }
}

/**
 * Turns whatever axios rejected with into one human-readable line.
 *
 * The API speaks two error shapes (F0-api.md §0): `{ "error": "..." }` for
 * 401/404/500 and `{ "errors": { field: [...] } }` for 422. Anything else
 * (network failure, timeout, HTML error page) has no usable body, so the
 * caller's `fallback` is used.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  const body = (error as ErrorWithResponse | undefined)?.response?.data
  if (body?.error) return body.error
  const firstFieldErrors = body?.errors && Object.values(body.errors)[0]
  if (firstFieldErrors?.[0]) return firstFieldErrors[0]
  return fallback
}
