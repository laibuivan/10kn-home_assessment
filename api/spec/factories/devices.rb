FactoryBot.define do
  factory :device do
    organization
    sequence(:identifier) { |n| "DEV-#{format('%05d', n)}" }
    sequence(:name) { |n| "Device #{n}" }
    platform { :ios }
    os_version { "17.4" }
    status { :active }
    last_seen_at { 2.hours.ago }

    trait :ios do
      platform { :ios }
    end

    trait :android do
      platform { :android }
      os_version { "14" }
    end

    trait :macos do
      platform { :macos }
      os_version { "14.4" }
    end

    trait :inactive do
      status { :inactive }
    end

    trait :retired do
      status { :retired }
    end

    # A device that has never checked in (os_version/last_seen_at are
    # nullable on purpose — docs/design/F2-db.md §4 OQ-D1).
    trait :never_seen do
      os_version { nil }
      last_seen_at { nil }
    end
  end
end
