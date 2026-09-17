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

# ---------------------------------------------------------------------------
# Groups (F5) — a handful per org so the Groups screen, its search box and the
# "same name allowed in a different org" rule are all demonstrable by hand.
# No 25-row pagination fixture here: that is spec data (FactoryBot), not seed
# data (docs/design/F5-db.md §2).
# Idempotent like everything above: keyed on (organization, name), which is
# exactly the composite unique index the schema enforces.
def upsert_group!(organization:, name:, description:)
  Group.find_or_create_by!(organization: organization, name: name) do |group|
    group.description = description
  end
end

ACME_GROUPS = [
  [ "Sales Team", "Máy của đội kinh doanh, đi công tác thường xuyên." ],
  [ "Engineering", "Laptop dev, cài đặt quyền cao hơn mặc định." ],
  [ "Field Ops", nil ],
  [ "Executives", "Thiết bị của ban lãnh đạo." ]
].freeze

# "Sales Team" deliberately appears in BOTH orgs — proves PRD's "unique in
# Organization, not globally" for Group.name the same way shared.login@ does
# for User.email.
GLOBEX_GROUPS = [
  [ "Sales Team", "Cùng tên với group của Acme — hợp lệ vì unique theo org." ],
  [ "Support", "Máy trực tổng đài." ]
].freeze

ACME_GROUPS.each { |name, description| upsert_group!(organization: acme, name: name, description: description) }
GLOBEX_GROUPS.each { |name, description| upsert_group!(organization: globex, name: name, description: description) }

puts "Seeded #{Group.count} groups (#{acme.groups.count} for #{acme.name}, #{globex.groups.count} for #{globex.name})."

# ---------------------------------------------------------------------------
# Group memberships (F6) — a few real links per org so Group Detail, the
# "Số device" column and the "Groups đang thuộc" block on Device Detail all
# have something to show during the README walkthrough.
#
# Small on purpose: the 10.000-row scale case is spec data
# (GroupMembership.insert_all in spec/requests/api/v1/group_devices_spec.rb),
# not seed data (docs/plan/F6-group-membership.md, Rủi ro).
# Idempotent like everything above: keyed on (group, device), which is exactly
# the composite unique index the schema enforces.
def link_devices_to_group!(organization:, group_name:, identifiers:)
  group = organization.groups.find_by!(name: group_name)

  identifiers.each do |identifier|
    device = organization.devices.find_by!(identifier: identifier)
    GroupMembership.find_or_create_by!(group: group, device: device)
  end
end

# ACME-0001..0012 exist from the device seed above; spread across groups so at
# least one device (ACME-0001) belongs to two groups at once — that is the
# PRD's "một Device thuộc nhiều Group" made visible by hand (SoT F6 A24).
link_devices_to_group!(organization: acme, group_name: "Sales Team",
                       identifiers: %w[ACME-0001 ACME-0002 ACME-0003 ACME-0004 ACME-0005])
link_devices_to_group!(organization: acme, group_name: "Engineering",
                       identifiers: %w[ACME-0001 ACME-0006 ACME-0007])
# "Field Ops" is left empty on purpose — the real "group has no devices yet"
# empty state (A19) needs a group that is genuinely empty to be seen.
link_devices_to_group!(organization: globex, group_name: "Sales Team",
                       identifiers: %w[GLBX-0001 GLBX-0002])

puts "Seeded #{GroupMembership.count} group memberships."

# ---------------------------------------------------------------------------
# Policies (F7) — a handful per org, varied type/status, so the Policies
# screen's search and status filter both have something visible to
# demonstrate. Idempotent like everything above: keyed on (organization,
# name), which is exactly the composite unique index the schema enforces.
def upsert_policy!(organization:, name:, type:, configuration:, status: :active)
  Policy.find_or_create_by!(organization: organization, name: name) do |policy|
    policy.type = type
    policy.configuration = configuration
    policy.status = status
  end
end

ACME_POLICIES = [
  [ "Password Baseline", "password", { "min_length" => 12, "require_symbol" => true }, :active ],
  [ "Corp WiFi", "wifi", { "ssid" => "Acme-Corp", "security" => "wpa2" }, :active ],
  [ "Legacy VPN", "vpn", { "protocol" => "ikev2" }, :inactive ]
].freeze

# "Corp WiFi" deliberately appears in BOTH orgs — proves PRD's "unique in
# Organization, not globally" for Policy.name, same way "Sales Team" does for
# Group.name.
GLOBEX_POLICIES = [
  [ "Corp WiFi", "wifi", { "ssid" => "Globex-Corp", "security" => "wpa3" }, :active ],
  [ "Screen Lock", "password", { "min_length" => 8, "auto_lock_minutes" => 5 }, :active ]
].freeze

ACME_POLICIES.each do |name, type, configuration, status|
  upsert_policy!(organization: acme, name: name, type: type, configuration: configuration, status: status)
end
GLOBEX_POLICIES.each do |name, type, configuration, status|
  upsert_policy!(organization: globex, name: name, type: type, configuration: configuration, status: status)
end

puts "Seeded #{Policy.count} policies (#{acme.policies.count} for #{acme.name}, #{globex.policies.count} for #{globex.name})."

# ---------------------------------------------------------------------------
# Policy assignments (F8) — a few Group + a few direct-Device assignments per
# org so the "Số nơi đang gán" column (Policy List) and the 2 Policy Detail
# tabs have something real to show. Idempotent like everything above:
# find_or_create_by! on (policy, group)/(policy, device) is exactly the pair
# the composite partial unique indexes enforce.
def upsert_group_assignment!(organization:, policy:, group:)
  PolicyAssignment.find_or_create_by!(organization: organization, policy: policy, group: group)
end

def upsert_device_assignment!(organization:, policy:, device:)
  PolicyAssignment.find_or_create_by!(organization: organization, policy: policy, device: device)
end

acme_password_baseline = acme.policies.find_by!(name: "Password Baseline")
acme_corp_wifi = acme.policies.find_by!(name: "Corp WiFi")
globex_corp_wifi = globex.policies.find_by!(name: "Corp WiFi")
globex_screen_lock = globex.policies.find_by!(name: "Screen Lock")

upsert_group_assignment!(organization: acme, policy: acme_password_baseline, group: acme.groups.find_by!(name: "Sales Team"))
upsert_group_assignment!(organization: acme, policy: acme_password_baseline, group: acme.groups.find_by!(name: "Engineering"))
upsert_group_assignment!(organization: acme, policy: acme_corp_wifi, group: acme.groups.find_by!(name: "Executives"))
upsert_device_assignment!(organization: acme, policy: acme_password_baseline, device: acme.devices.find_by!(identifier: "ACME-0001"))
upsert_device_assignment!(organization: acme, policy: acme_corp_wifi, device: acme.devices.find_by!(identifier: "ACME-0002"))

upsert_group_assignment!(organization: globex, policy: globex_corp_wifi, group: globex.groups.find_by!(name: "Sales Team"))
upsert_group_assignment!(organization: globex, policy: globex_screen_lock, group: globex.groups.find_by!(name: "Support"))
upsert_device_assignment!(organization: globex, policy: globex_corp_wifi, device: globex.devices.find_by!(identifier: "GLBX-0001"))

puts "Seeded #{PolicyAssignment.count} policy assignments " \
     "(#{acme.policy_assignments.count} for #{acme.name}, #{globex.policy_assignments.count} for #{globex.name})."

# ---------------------------------------------------------------------------
# Large Group + async job demo (F8) — proves the Solid Queue path end to
# end: a Group with a few hundred devices, one PolicyAssignmentJob enqueued
# for it via GroupPolicyAssignmentJob.perform_later DIRECTLY (not through
# HTTP — this is seed data, not a request spec), the exact same 2 steps
# GroupPolicyAssignmentsController#create wraps in one transaction. Needs
# the `worker` service (docker-compose.yml) actually running to finish —
# otherwise the job simply stays "pending" until it does (see README).
#
# 300, not 10.000 — enough to see the job take a moment without making
# `docker compose up --build`'s first run slow (docs/plan/F8-policy-
# assignment.md T31).
BULK_GROUP_DEVICE_COUNT = 300

def seed_bulk_group!(organization:, prefix:, policy:)
  group = Group.find_or_create_by!(organization: organization, name: "Bulk Ops (F8 demo)") do |g|
    g.description = "Nhóm lớn cho demo Solid Queue job (F8) — #{BULK_GROUP_DEVICE_COUNT} device."
  end

  device_ids = BULK_GROUP_DEVICE_COUNT.times.map do |i|
    identifier = "#{prefix}-BULK-#{format('%04d', i + 1)}"
    device = Device.find_or_create_by!(organization: organization, identifier: identifier) do |d|
      d.name = "Bulk Device #{format('%04d', i + 1)}"
      d.platform = :android
      d.status = :active
      d.os_version = "14"
      d.last_seen_at = 1.hour.ago
    end
    device.id
  end

  now = Time.current
  GroupMembership.upsert_all(
    device_ids.map { |device_id| { group_id: group.id, device_id: device_id, created_at: now, updated_at: now } },
    unique_by: [ :group_id, :device_id ]
  )

  # Idempotent across re-runs, same dedupe reasoning as
  # GroupPolicyAssignmentsController#find_or_create_policy_assignment_job
  # (OQ-5): once the assignment exists (job finished), or a job is still
  # pending/running, don't enqueue a second one.
  if PolicyAssignment.exists?(policy_id: policy.id, group_id: group.id)
    puts "'#{policy.name}' already assigned to '#{group.name}' (#{organization.name}) — no job needed."
  elsif organization.policy_assignment_jobs.where(policy_id: policy.id, group_id: group.id, status: %i[pending running]).exists?
    puts "A job assigning '#{policy.name}' to '#{group.name}' (#{organization.name}) is already pending/running."
  else
    job = organization.policy_assignment_jobs.create!(
      policy_id: policy.id,
      group_id: group.id,
      status: :pending,
      total_count: group.devices.count,
      processed_count: 0
    )
    GroupPolicyAssignmentJob.perform_later(job.id)
    puts "Enqueued GroupPolicyAssignmentJob##{job.id} — '#{policy.name}' -> '#{group.name}' (#{organization.name}, " \
         "#{job.total_count} devices)."
  end

  group
end

seed_bulk_group!(organization: acme, prefix: "ACME", policy: acme_password_baseline)
seed_bulk_group!(organization: globex, prefix: "GLBX", policy: globex_corp_wifi)
