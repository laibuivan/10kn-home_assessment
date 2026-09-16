class Device < ApplicationRecord
  belongs_to :organization

  # Integer-backed native enums, same style as User#status (F0) — see
  # docs/design/F2-db.md §1b for why no parallel DB check constraint.
  enum :platform, { ios: 0, android: 1, macos: 2 }
  enum :status, { active: 0, inactive: 1, retired: 2 }

  IDENTIFIER_TAKEN_MESSAGE = "Identifier này đã tồn tại trong tổ chức của bạn.".freeze
  RETIRED_IMMUTABLE_MESSAGE = "Thiết bị đã retired, không thể sửa".freeze

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
