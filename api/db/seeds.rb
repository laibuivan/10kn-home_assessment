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
