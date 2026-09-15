FactoryBot.define do
  factory :organization do
    sequence(:name) { |n| "Org #{n}" }
  end
end
