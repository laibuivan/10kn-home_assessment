require "rails_helper"

RSpec.describe PolicyAssignment, type: :model do
  let(:organization) { create(:organization) }
  let(:policy) { create(:policy, organization: organization) }
  let(:group) { create(:group, organization: organization) }
  let(:device) { create(:device, organization: organization) }

  describe "model validation — exactly one of group/device (docs/design/F8-db.md §1a)" do
    it "is valid with only group_id present" do
      assignment = PolicyAssignment.new(organization: organization, policy: policy, group: group)

      expect(assignment).to be_valid
    end

    it "is valid with only device_id present" do
      assignment = PolicyAssignment.new(organization: organization, policy: policy, device: device)

      expect(assignment).to be_valid
    end

    it "is invalid when both group_id and device_id are present" do
      assignment = PolicyAssignment.new(organization: organization, policy: policy, group: group, device: device)

      expect(assignment).not_to be_valid
      expect(assignment.errors[:base]).to include(PolicyAssignment::EXACTLY_ONE_TARGET_MESSAGE)
    end

    it "is invalid when neither group_id nor device_id is present" do
      assignment = PolicyAssignment.new(organization: organization, policy: policy)

      expect(assignment).not_to be_valid
      expect(assignment.errors[:base]).to include(PolicyAssignment::EXACTLY_ONE_TARGET_MESSAGE)
    end
  end

  # `upsert_all` (the real write path in F8) skips every validation and
  # callback declared above, so the DB CHECK constraint is the layer that
  # actually protects this invariant on that path (docs/design/F8-db.md
  # §1a) — bypass the model entirely with raw SQL to prove the constraint,
  # not the validation, is what raises.
  describe "CHECK constraint chk_policy_assignments_exactly_one_target (bypassing model validation)" do
    def raw_insert(group_id:, device_id:)
      ActiveRecord::Base.connection.execute(<<~SQL.squish)
        INSERT INTO policy_assignments
          (organization_id, policy_id, group_id, device_id, created_at, updated_at)
        VALUES
          (#{organization.id}, #{policy.id}, #{group_id || "NULL"}, #{device_id || "NULL"}, NOW(), NOW())
      SQL
    end

    it "raises when both group_id and device_id are NULL" do
      expect { raw_insert(group_id: nil, device_id: nil) }.to raise_error(ActiveRecord::StatementInvalid)
    end

    it "raises when both group_id and device_id are present" do
      expect { raw_insert(group_id: group.id, device_id: device.id) }.to raise_error(ActiveRecord::StatementInvalid)
    end

    it "does not raise when exactly one of group_id/device_id is present" do
      expect { raw_insert(group_id: group.id, device_id: nil) }.not_to raise_error
    end
  end

  describe "upsert_all idempotency (A12, A13)" do
    def upsert_group_row
      now = Time.current
      PolicyAssignment.upsert_all(
        [ { organization_id: organization.id, policy_id: policy.id, group_id: group.id,
            created_at: now, updated_at: now } ],
        unique_by: :index_policy_assignments_on_policy_and_group, on_duplicate: :skip
      )
    end

    def upsert_device_row
      now = Time.current
      PolicyAssignment.upsert_all(
        [ { organization_id: organization.id, policy_id: policy.id, device_id: device.id,
            created_at: now, updated_at: now } ],
        unique_by: :index_policy_assignments_on_policy_and_device, on_duplicate: :skip
      )
    end

    it "creates exactly one row for the (policy, group) pair no matter how many times it is called" do
      3.times { upsert_group_row }

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end

    it "creates exactly one row for the (policy, device) pair no matter how many times it is called" do
      3.times { upsert_device_row }

      expect(PolicyAssignment.where(policy_id: policy.id, device_id: device.id).count).to eq(1)
    end

    it "lets the same policy be assigned to both a group and a device without collision (A23)" do
      upsert_group_row
      upsert_device_row

      expect(PolicyAssignment.where(policy_id: policy.id).count).to eq(2)
    end
  end
end
