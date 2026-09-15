# Idempotent on purpose (SoT F0-foundation.md §11 "Chạy seed nhiều lần không
# tạo trùng dữ liệu") — find_or_create_by!/find_or_initialize_by, never
# create!, so re-running this is always safe.
#
# Two Organizations, proving tenant isolation end to end:

acme = Organization.find_or_create_by!(name: "Acme Inc.")
globex = Organization.find_or_create_by!(name: "Globex Corp.")

def upsert_user!(organization:, email:, password:, status: :active)
  user = User.find_or_initialize_by(organization: organization, email: email)
  user.password = password
  user.status = status
  user.save!
  user
end

# Primary walkthrough accounts (see README) — one per org, same password so
# a reviewer only has to remember one.
upsert_user!(organization: acme, email: "admin@acme.example", password: "Password123!")
upsert_user!(organization: globex, email: "admin@globex.example", password: "Password123!")

# Fixture proving PRD's "email unique in Organization, not globally" — same
# email in both orgs, correct login lands in the org whose password matched
# (SoT §12 OQ-2).
upsert_user!(organization: acme, email: "shared.login@example.com", password: "AcmePass123!")
upsert_user!(organization: globex, email: "shared.login@example.com", password: "GlobexPass123!")

# Fixture proving inactive users can't log in (SoT §5.2 A3).
upsert_user!(organization: acme, email: "inactive@acme.example", password: "Password123!", status: :inactive)

puts "Seeded #{Organization.count} organizations, #{User.count} users."

# ---------------------------------------------------------------------------
# Devices (F2) — enough rows, spread across every platform/status combo, that
# pagination and filtering are actually demonstrable in the UI (SoT F2 §3).
# Idempotent like everything above: keyed on (organization, identifier), which
# is exactly the composite unique index the schema enforces.
def upsert_device!(organization:, identifier:, name:, platform:, status:, os_version:, last_seen_at:)
  Device.find_or_create_by!(organization: organization, identifier: identifier) do |device|
    device.name = name
    device.platform = platform
    device.status = status
    device.os_version = os_version
    device.last_seen_at = last_seen_at
  end
end

PLATFORMS = %i[ios android macos].freeze
STATUSES = %i[active inactive retired].freeze
OS_VERSIONS = { ios: "17.4", android: "14", macos: "14.4" }.freeze

def seed_devices!(organization:, prefix:, count:)
  count.times do |i|
    platform = PLATFORMS[i % PLATFORMS.size]
    status = STATUSES[(i / 2) % STATUSES.size]
    # Every 10th device has never checked in — proves the nullable
    # os_version/last_seen_at path ("—" in the Last seen column).
    never_seen = (i % 10).zero?

    upsert_device!(
      organization: organization,
      identifier: "#{prefix}-#{format('%04d', i + 1)}",
      name: "#{platform.to_s.upcase} #{format('%04d', i + 1)}",
      platform: platform,
      status: status,
      os_version: never_seen ? nil : OS_VERSIONS.fetch(platform),
      last_seen_at: never_seen ? nil : (i + 1).hours.ago
    )
  end
end

# 47 = not a multiple of per_page (20) on purpose: the last page is partial,
# which is the interesting pagination case to eyeball (SoT F2 §5.2 A5).
seed_devices!(organization: acme, prefix: "ACME", count: 47)
# A second org with its own devices — makes tenant isolation visible by
# logging in as admin@globex.example and seeing a completely different list.
seed_devices!(organization: globex, prefix: "GLBX", count: 8)

puts "Seeded #{Device.count} devices (#{acme.devices.count} for #{acme.name}, #{globex.devices.count} for #{globex.name})."
