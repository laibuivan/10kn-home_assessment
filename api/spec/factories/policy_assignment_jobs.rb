FactoryBot.define do
  factory :policy_assignment_job do
    organization
    policy { association :policy, organization: organization }
    group { association :group, organization: organization }
    status { :pending }
    total_count { 0 }
    processed_count { 0 }

    trait :pending do
      status { :pending }
    end

    trait :running do
      status { :running }
    end

    trait :done do
      status { :done }
      processed_count { total_count }
    end

    trait :failed do
      status { :failed }
      error_message { PolicyAssignmentJob::GROUP_DELETED_MESSAGE }
    end
  end
end
