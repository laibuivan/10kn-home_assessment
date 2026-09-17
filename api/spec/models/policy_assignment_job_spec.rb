require "rails_helper"

RSpec.describe PolicyAssignmentJob, type: :model do
  let(:organization) { create(:organization) }
  let(:policy) { create(:policy, organization: organization) }
  let(:group) { create(:group, organization: organization) }

  describe "status enum" do
    it "exposes exactly the four SoT-canonical statuses (OQ-1)" do
      expect(PolicyAssignmentJob.statuses.keys).to contain_exactly("pending", "running", "done", "failed")
    end

    it "defaults to pending" do
      job = PolicyAssignmentJob.new(organization: organization, policy: policy, group: group)

      expect(job.pending?).to be(true)
    end
  end

  describe "numericality on total_count/processed_count" do
    it "is invalid with a negative total_count" do
      job = PolicyAssignmentJob.new(organization: organization, policy: policy, group: group, total_count: -1)

      expect(job).not_to be_valid
      expect(job.errors[:total_count]).to be_present
    end

    it "is invalid with a negative processed_count" do
      job = PolicyAssignmentJob.new(organization: organization, policy: policy, group: group, processed_count: -1)

      expect(job).not_to be_valid
      expect(job.errors[:processed_count]).to be_present
    end

    it "is valid with total_count and processed_count both zero" do
      job = PolicyAssignmentJob.new(organization: organization, policy: policy, group: group)

      expect(job).to be_valid
    end
  end

  describe "group_id nullable (docs/design/F8-db.md §1c — simulates a Group already deleted)" do
    it "is valid with group: nil" do
      job = PolicyAssignmentJob.new(organization: organization, policy: policy, group: nil, status: :failed,
                                     error_message: PolicyAssignmentJob::GROUP_DELETED_MESSAGE)

      expect(job).to be_valid
    end

    it "persists and reloads with group_id NULL without raising" do
      job = create(:policy_assignment_job, :failed, organization: organization, policy: policy, group: group)
      job.update_columns(group_id: nil)

      expect(job.reload.group).to be_nil
      expect(job.reload.failed?).to be(true)
    end
  end
end
