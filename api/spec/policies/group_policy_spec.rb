require "rails_helper"

RSpec.describe GroupPolicy, type: :policy do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }

  describe "#index?" do
    it "allows any active user of an organization to list groups (no in-org roles)" do
      expect(described_class.new(user, Group).index?).to be(true)
    end
  end

  describe "#create?" do
    it "allows any active user of an organization to create a group (no in-org roles)" do
      expect(described_class.new(user, Group).create?).to be(true)
    end
  end

  describe "#update?" do
    it "allows any active user of an organization to update a group (no in-org roles)" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).update?).to be(true)
    end
  end

  describe "#destroy?" do
    it "allows any active user of an organization to delete a group (no in-org roles)" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).destroy?).to be(true)
    end
  end

  describe "#show?" do
    it "stays deny-by-default — F5 has no show action (SoT OQ-5), so nothing opts it in" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).show?).to be(false)
    end
  end

  describe "Scope" do
    subject(:resolved) { described_class::Scope.new(user, Group).resolve }

    it "resolves only the groups of the user's own organization" do
      mine = create(:group, organization: organization)
      create(:group, organization: create(:organization))

      expect(resolved).to contain_exactly(mine)
    end

    it "never leaks another organization's groups, not even in the count" do
      create_list(:group, 2, organization: organization)
      create_list(:group, 5, organization: create(:organization))

      expect(resolved.count).to eq(2)
    end

    it "resolves nothing for an organization with no groups of its own" do
      create_list(:group, 3, organization: create(:organization))

      expect(resolved).to be_empty
    end
  end
end
