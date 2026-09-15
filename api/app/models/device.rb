class Device < ApplicationRecord
  belongs_to :organization

  # Integer-backed native enums, same style as User#status (F0) — see
  # docs/design/F2-db.md §1b for why no parallel DB check constraint.
  enum :platform, { ios: 0, android: 1, macos: 2 }
  enum :status, { active: 0, inactive: 1, retired: 2 }

  validates :identifier, presence: true,
                         uniqueness: { scope: :organization_id, case_sensitive: true }
  validates :name, presence: true
  validates :platform, :status, presence: true
end
