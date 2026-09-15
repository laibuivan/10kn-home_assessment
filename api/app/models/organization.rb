class Organization < ApplicationRecord
  # restrict_with_error, not dependent: :destroy — deleting an Organization
  # is not a flow this product supports (no Organization management UI per
  # PRD); guard against it at the model layer too, not just "there's no
  # button for it" (docs/design/F0-db.md §1).
  has_many :users, dependent: :restrict_with_error
  # No `dependent:` yet on purpose — nothing in the product deletes an
  # Organization (see above), so there is no cascade to decide. Revisit
  # together with the Organization-delete flow if one is ever added
  # (docs/design/F2-db.md §4).
  has_many :devices

  validates :name, presence: true
end
