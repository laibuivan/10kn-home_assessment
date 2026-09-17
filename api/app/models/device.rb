class Device < ApplicationRecord
  belongs_to :organization

  # No `dependent:` — the PRD has no delete-a-device flow, so there is
  # nothing to clean up after (docs/design/F6-db.md §1). Whoever adds one
  # owes this association an explicit `dependent:` in the same change.
  has_many :group_memberships
  has_many :groups, through: :group_memberships
  # No `dependent:` — same reasoning as :group_memberships above, there is no
  # delete-a-device flow (docs/design/F8-db.md §1).
  has_many :policy_assignments

  # Integer-backed native enums, same style as User#status (F0) — see
  # docs/design/F2-db.md §1b for why no parallel DB check constraint.
  enum :platform, { ios: 0, android: 1, macos: 2 }
  enum :status, { active: 0, inactive: 1, retired: 2 }

  IDENTIFIER_TAKEN_MESSAGE = "Identifier này đã tồn tại trong tổ chức của bạn.".freeze
  RETIRED_IMMUTABLE_MESSAGE = "Thiết bị đã retired, không thể sửa".freeze
  # One constant, three call sites (F6): adding a retired device to a group,
  # removing one from a group, and the atomic-reject branch that refuses a
  # whole batch containing any retired device. Membership changes do not go
  # through Device#save, so `block_all_changes_when_retired` below cannot see
  # them — Api::V1::GroupDevicesController enforces the same invariant with
  # this message (CLAUDE.md §4 "retired bất biến", SoT F6 A8/A9/A27).
  RETIRED_GROUP_MESSAGE = "Thiết bị đã retired, không thể thay đổi group".freeze
  # F8 — same "retired bất biến" invariant, but for direct Policy assignment
  # rather than group membership (docs/design/F8-api.md §3). A distinct
  # constant, not a reuse of RETIRED_GROUP_MESSAGE — different action, same
  # "family" of invariant, same pattern F6 already established of one
  # message per action rather than one generic message for all of them.
  RETIRED_POLICY_MESSAGE = "Thiết bị đã retired, không thể gán policy trực tiếp.".freeze

  # Declared first — SoT §4 bước 3: "kiểm tra retired trước tiên", short-
  # circuits the entire remaining validate chain via throw(:abort) so a
  # retired device never gets a mix of retired-block + field errors
  # (docs/design/F3-db.md §1b).
  before_validation :block_all_changes_when_retired, on: :update
  before_validation :restore_immutable_identifier, on: :update

  validates :identifier, presence: true,
                         uniqueness: { scope: :organization_id, case_sensitive: true, message: IDENTIFIER_TAKEN_MESSAGE }
  validates :name, presence: true
  validates :platform, :status, presence: true

  # Viewing a device's detail page bumps `last_seen_at` to now (F4 follow-up
  # — not in PRD, a deliberate product decision made after F4 shipped, see
  # DESIGN.md §AI). Uses `update_column` — a direct single-column SQL write
  # that skips validations *and* callbacks entirely — rather than `update`,
  # for two reasons:
  #   1. "Retired bất biến" (CLAUDE.md §4) must hold absolutely: the caller
  #      guards with `retired?` below, but even if it didn't, going through
  #      `update` would either get blocked by `block_all_changes_when_retired`
  #      (fine) or — worse — silently succeed for a retired device if that
  #      guard were ever refactored away, since this call site has nothing
  #      to do with the "sửa" flow that callback exists to protect.
  #   2. This is telemetry bookkeeping, not a user edit — it should not bump
  #      `updated_at` (which `update`/`touch` would) or re-run presence/
  #      uniqueness validations for a single already-valid column.
  def record_seen!
    return if retired?

    update_column(:last_seen_at, Time.current)
  end

  private

  # "Retired bất biến" (CLAUDE.md §4) — status_was reflects the persisted
  # value before this save cycle applies any change, so transitioning INTO
  # retired (status_was == "active") is unaffected, while any update on an
  # already-retired record (including a true no-op) is blocked unconditionally.
  def block_all_changes_when_retired
    return unless status_was == "retired"

    errors.add(:base, RETIRED_IMMUTABLE_MESSAGE)
    throw(:abort)
  end

  # "Identifier bất biến sau khi tạo" (docs/design/F3-db.md §1a) — a second,
  # independent layer of defense below strong params: silently resets any
  # in-memory identifier change before validate/save runs, so there is never
  # a gap between what is persisted and what a response could serialize.
  def restore_immutable_identifier
    self.identifier = identifier_was if identifier_changed?
  end
end
