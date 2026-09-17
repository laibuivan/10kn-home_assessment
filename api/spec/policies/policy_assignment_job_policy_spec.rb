require "rails_helper"

RSpec.describe PolicyAssignmentJobPolicy, type: :policy do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }

  describe "#show?" do
    it "allows any active user of an organization to read one of its jobs (no in-org roles, A31)" do
      job = create(:policy_assignment_job, organization: organization)

      expect(described_class.new(user, job).show?).to be(true)
    end
  end

  describe "Scope" do
    subject(:resolved) { described_class::Scope.new(user, PolicyAssignmentJob).resolve }

    it "resolves only the jobs of the user's own organization (S13, S15)" do
      mine = create(:policy_assignment_job, organization: organization)
      create(:policy_assignment_job, organization: create(:organization))

      expect(resolved).to contain_exactly(mine)
    end

    it "never leaks another organization's jobs, not even in the count" do
      create_list(:policy_assignment_job, 2, organization: organization)
      create_list(:policy_assignment_job, 3, organization: create(:organization))

      expect(resolved.count).to eq(2)
    end

    it "resolves nothing for an organization with no jobs of its own" do
      create_list(:policy_assignment_job, 3, organization: create(:organization))

      expect(resolved).to be_empty
    end
  end
end
