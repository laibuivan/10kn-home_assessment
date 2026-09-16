FactoryBot.define do
  # Two plain associations, no traits — the table is two foreign keys and
  # nothing else (docs/design/F6-db.md §1).
  #
  # Note the default builds a group and a device in two DIFFERENT
  # organizations (each association creates its own). That is on purpose: the
  # model has no org-match validation (F6-db.md §1b), and specs that need a
  # realistic row must pass both `group:` and `device:` from the same org
  # themselves — while the cross-org specs (A2/A3/A10) want exactly this
  # default.
  factory :group_membership do
    association :group
    association :device
  end
end
