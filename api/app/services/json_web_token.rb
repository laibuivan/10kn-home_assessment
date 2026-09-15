# Encode/decode for the SPA session token — see docs/design/F0-api.md §2-3.
# HS256, secret from Rails credentials (never hard-coded, never committed
# in plaintext — config/master.key is gitignored).
class JsonWebToken
  ALGORITHM = "HS256".freeze

  # expires_in accepts a numeric offset in hours, e.g. 24 (default) or a
  # negative number to mint an already-expired token (used by the
  # acceptance suite to exercise expiry — see features/steps/).
  def self.encode(payload, expires_in = 24)
    payload = payload.merge(exp: expires_in.hours.from_now.to_i)
    JWT.encode(payload, secret, ALGORITHM)
  end

  # Returns the decoded payload (HashWithIndifferentAccess) or nil — every
  # decode failure (bad signature, malformed, expired) collapses to the same
  # nil so callers don't have to enumerate JWT::DecodeError subclasses.
  def self.decode(token)
    decoded = JWT.decode(token, secret, true, algorithm: ALGORITHM)[0]
    ActiveSupport::HashWithIndifferentAccess.new(decoded)
  rescue JWT::DecodeError
    nil
  end

  def self.secret
    Rails.application.credentials.jwt_secret or
      raise "Missing credentials.jwt_secret — run `bin/rails credentials:edit`"
  end
end
