FactoryBot.define do
  factory :policy do
    organization
    # Sequenced, not a fixed literal: `policies(organization_id, name)` is a
    # unique index, so a constant name would blow up the moment a spec builds
    # two policies in the same org (docs/design/F7-db.md §2).
    sequence(:name) { |n| "Policy #{n}" }
    type { "password" }
    configuration { { key: "value" } }
    status { :active }

    trait :inactive do
      status { :inactive }
    end
  end
end
