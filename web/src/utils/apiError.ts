/** Shape of an error response body — see docs/design/F0-api.md §0. */
export interface ApiErrorBody {
  error?: string
  errors?: Record<string, string[]>
}

interface ErrorWithResponse {
  response?: { status?: number; data?: ApiErrorBody }
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

/**
 * Splits a form-submission error into field-level errors vs. a single
 * banner message — F3-frontend.md §3 / F3-api.md §0 OQ-4.
 *
 * The API's `errors` key `base` is not a field name — it means "the whole
 * request was rejected" (e.g. the retired-block message), so it renders as
 * a banner above the form instead of under a field. Every other key is a
 * real field and keeps its message(s) for `field-error-<field>` rendering.
 *
 * A single `error` key (401/404-shaped) is trusted as the banner text only
 * for a sub-500 status — F3-api.md §5 leaves 500/infra handling to "FE tự
 * xử lý theo status code chung": a 5xx is always the generic
 * infrastructure-error banner, even if the response happens to carry a
 * JSON body with an `error` string (e.g. a proxy/500 page or a test double
 * — SoT A13), so a raw server-internals message is never shown to the
 * user. No usable body at all (network/timeout, no JSON) also falls back
 * to `genericFallback`.
 */
/**
 * True only for a real 404 response — used by `DeviceDetailView` to render
 * the full-page "not found" state instead of the generic retry banner
 * (F4-frontend.md §3/§4). Distinct from `extractErrorMessage`/
 * `extractFormErrors`, which never need to single out 404 specifically.
 */
export function isNotFoundError(error: unknown): boolean {
  return (error as ErrorWithResponse | undefined)?.response?.status === 404
}

export function extractFormErrors(
  error: unknown,
  genericFallback: string,
): { fieldErrors: Record<string, string[]>; baseError: string | null } {
  const response = (error as ErrorWithResponse | undefined)?.response
  const body = response?.data
  if (body?.errors) {
    const fieldErrors: Record<string, string[]> = {}
    let baseError: string | null = null
    for (const [key, messages] of Object.entries(body.errors)) {
      if (key === 'base') baseError = messages[0] ?? null
      else fieldErrors[key] = messages
    }
    return { fieldErrors, baseError }
  }
  if (body?.error && response?.status !== undefined && response.status < 500) {
    return { fieldErrors: {}, baseError: body.error }
  }
  return { fieldErrors: {}, baseError: genericFallback }
}
