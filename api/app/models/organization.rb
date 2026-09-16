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
  # Same "no `dependent:` decided yet" reasoning as :devices above
  # (docs/design/F5-db.md §4c) — nothing in the product deletes an
  # Organization, so there is no cascade to choose. Decide for users/devices/
  # groups in one go if an Organization-delete flow is ever added.
  has_many :groups

  validates :name, presence: true
end
