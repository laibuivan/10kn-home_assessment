FactoryBot.define do
  factory :user do
    organization
    sequence(:email) { |n| "user#{n}@example.com" }
    password { "Password123!" }
    status { :active }

    trait :inactive do
      status { :inactive }
    end
  end
end
