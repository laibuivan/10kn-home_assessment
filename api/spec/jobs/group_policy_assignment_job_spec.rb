require "rails_helper"

RSpec.describe GroupPolicyAssignmentJob, type: :job do
  let(:organization) { create(:organization) }
  let(:policy) { create(:policy, organization: organization, status: :active) }
  let(:group) { create(:group, organization: organization) }

  def create_pending_job(total_count: 0)
    create(:policy_assignment_job, :pending, organization: organization, policy: policy, group: group,
                                              total_count: total_count)
  end

  describe "#perform (S1, S9)" do
    it "creates exactly one policy_assignment row for the (policy, group) pair" do
      job = create_pending_job(total_count: 3)

      described_class.perform_now(job.id)

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end

    it "sets the job to done and jumps processed_count straight to total_count (cosmetic, OQ-DB-1)" do
      job = create_pending_job(total_count: 3)

      described_class.perform_now(job.id)

      job.reload
      expect(job.status).to eq("done")
      expect(job.processed_count).to eq(3)
    end

    it "is idempotent — running it twice does not duplicate the assignment row (A13)" do
      job = create_pending_job(total_count: 1)

      described_class.perform_now(job.id)
      job.update!(status: :pending)
      described_class.perform_now(job.id)

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end

    it "succeeds even when a Group has both a retired and an active device (S9, A8)" do
      create(:device, organization: organization, status: :retired).tap { |d| create(:group_membership, group: group, device: d) }
      create(:device, organization: organization, status: :active).tap { |d| create(:group_membership, group: group, device: d) }
      job = create_pending_job(total_count: 2)

      described_class.perform_now(job.id)

      expect(job.reload.status).to eq("done")
      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end

    it "does nothing when the job is already done" do
      job = create(:policy_assignment_job, :done, organization: organization, policy: policy, group: group)

      described_class.perform_now(job.id)

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(0)
    end

    it "does nothing when the job is already failed" do
      job = create(:policy_assignment_job, :failed, organization: organization, policy: policy, group: group)

      described_class.perform_now(job.id)

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(0)
    end

    it "runs a job that is already running (worker restart / retry) without erroring" do
      job = create(:policy_assignment_job, :running, organization: organization, policy: policy, group: group)

      described_class.perform_now(job.id)

      expect(job.reload.status).to eq("done")
    end
  end

  describe "Group deleted before the worker picks up the job (S12/A10)" do
    it "fails the job with GROUP_DELETED_MESSAGE when group_id is already nil" do
      job = create_pending_job
      # Simulates Group#fail_pending_policy_assignment_jobs already having
      # run (before_destroy), then dependent: :nullify clearing group_id —
      # the guard `return unless job.pending? || job.running?` would
      # normally short-circuit first in real life; this spec targets the
      # narrower Group.find rescue directly, per docs/design/F8-db.md §4c.
      job.update_columns(group_id: nil, status: PolicyAssignmentJob.statuses[:pending])

      described_class.perform_now(job.id)

      expect(job.reload.status).to eq("failed")
      expect(job.error_message).to eq(PolicyAssignmentJob::GROUP_DELETED_MESSAGE)
    end
  end

  describe "enqueuing via ActiveJob (:test adapter)" do
    it "runs the assignment synchronously inside perform_enqueued_jobs" do
      job = create_pending_job(total_count: 1)

      perform_enqueued_jobs do
        described_class.perform_later(job.id)
      end

      expect(job.reload.status).to eq("done")
      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end
  end
end
