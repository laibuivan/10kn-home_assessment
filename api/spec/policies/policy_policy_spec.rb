require "rails_helper"

RSpec.describe PolicyPolicy, type: :policy do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }

  describe "#index?" do
    it "allows any active user of an organization to list policies (no in-org roles)" do
      expect(described_class.new(user, Policy).index?).to be(true)
    end
  end

  describe "#create?" do
    it "allows any active user of an organization to create a policy (no in-org roles)" do
      expect(described_class.new(user, Policy).create?).to be(true)
    end
  end

  describe "#update?" do
    it "allows any active user of an organization to update a policy (no in-org roles)" do
      policy = create(:policy, organization: organization)

      expect(described_class.new(user, policy).update?).to be(true)
    end
  end

  # SoT OQ-2/OQ-7: F7 has no show/destroy action. ApplicationPolicy's
  # default-deny keeps protecting these if a route is ever accidentally
  # added without updating this policy.
  describe "#show?" do
    it "is not explicitly granted, defaulting to deny" do
      policy = create(:policy, organization: organization)

      expect(described_class.new(user, policy).show?).to be(false)
    end
  end

  describe "#destroy?" do
    it "is not explicitly granted, defaulting to deny" do
      policy = create(:policy, organization: organization)

      expect(described_class.new(user, policy).destroy?).to be(false)
    end
  end

  describe "Scope" do
    subject(:resolved) { described_class::Scope.new(user, Policy).resolve }

    it "resolves only the policies of the user's own organization" do
      mine = create(:policy, organization: organization)
      create(:policy, organization: create(:organization))

      expect(resolved).to contain_exactly(mine)
    end

    it "never leaks another organization's policies, not even in the count" do
      create_list(:policy, 2, organization: organization)
      create_list(:policy, 5, organization: create(:organization))

      expect(resolved.count).to eq(2)
    end

    it "resolves nothing for an organization with no policies of its own" do
      create_list(:policy, 3, organization: create(:organization))

      expect(resolved).to be_empty
    end
  end
end
