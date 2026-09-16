class Group < ApplicationRecord
  belongs_to :organization

  # Half of the carry-over contract F5 opened (docs/design/F5-db.md §4a) is
  # paid here; F8 still owes `has_many :policy_assignments, dependent:
  # :delete_all` once that table exists. GroupsController#destroy has called
  # `destroy!` since F5 precisely so this line starts working with no change
  # there (SoT F6 A20: deleting a group must leave zero orphaned join rows,
  # and must not delete a single Device).
  #
  # `:delete_all`, not `:destroy` — a join row carries no business callback,
  # and a 10.000-member group would otherwise instantiate 10.000 Ruby objects
  # to issue 10.000 DELETEs instead of one statement (docs/design/F6-db.md §1).
  # Rails still wraps that DELETE and the group's own DELETE in one
  # transaction, so no manual transaction here.
  has_many :group_memberships, dependent: :delete_all
  has_many :devices, through: :group_memberships

  # One constant, two call sites: the uniqueness validation below and the
  # RecordNotUnique rescue in GroupsController. The client must not be able
  # to tell the app-level check from the DB-level race (SoT F5 A5 vs A7).
  NAME_TAKEN_MESSAGE = "Tên group này đã tồn tại trong tổ chức của bạn.".freeze
  NAME_BLANK_MESSAGE = "Tên group không được để trống".freeze

  before_validation :normalize_name_and_description

  validates :name, presence: { message: NAME_BLANK_MESSAGE },
                   length: { maximum: 100 },
                   uniqueness: { scope: :organization_id,
                                 case_sensitive: true,
                                 message: NAME_TAKEN_MESSAGE }
  validates :description, length: { maximum: 500 }, allow_nil: true

  private

  # Mandatory, not cosmetic (docs/design/F5-db.md §1b):
  #   1. trimming `name` makes the validated value identical to the value the
  #      composite unique index sees, so "Sales Team" and "Sales Team " can
  #      never become two rows that look identical in the UI;
  #   2. `description.strip.presence` collapses "" / "   " to NULL, so
  #      "no description" has exactly one representation in the database.
  # The is_a?(String) guards keep a JSON `null` (or any non-string) falling
  # through to the presence/length validators — a 422, never a NoMethodError.
  def normalize_name_and_description
    self.name = name.strip if name.is_a?(String)
    self.description = description.strip.presence if description.is_a?(String)
  end
end
