class Organization < ApplicationRecord
  # restrict_with_error, not dependent: :destroy — deleting an Organization
  # is not a flow this product supports (no Organization management UI per
  # PRD); guard against it at the model layer too, not just "there's no
  # button for it" (docs/design/F0-db.md §1).
  has_many :users, dependent: :restrict_with_error

  validates :name, presence: true
end
