FactoryBot.define do
  # No default trait — a bare `create(:policy_assignment)` would violate the
  # "exactly one of group/device" invariant (docs/design/F8-db.md §1a), so
  # every spec must pick :for_group or :for_device explicitly.
  factory :policy_assignment do
    organization
    policy

    trait :for_group do
      group
      device { nil }
      # Same-org default, mirroring group_membership's cross-org default in
      # spirit but opposite: F8's write paths build organization_id from the
      # Group/Policy themselves, so a realistic row needs all three to
      # match. Specs that want a cross-org row pass organization: explicitly.
      organization { group.organization }
      policy { association :policy, organization: organization }
    end

    trait :for_device do
      device
      group { nil }
      organization { device.organization }
      policy { association :policy, organization: organization }
    end
  end
end
