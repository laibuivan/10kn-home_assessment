FactoryBot.define do
  factory :group do
    organization
    # Sequenced, not a fixed literal: `groups(organization_id, name)` is a
    # unique index, so a constant name would blow up the moment a spec builds
    # two groups in the same org (docs/design/F5-db.md §2).
    sequence(:name) { |n| "Group #{n}" }
    description { "Managed by the ops team." }

    # description is optional and normalized to NULL when blank (SoT F5 A25).
    trait :without_description do
      description { nil }
    end
  end
end
