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

  # Three actions F6 added. They are authorized explicitly by name at every
  # call site (`authorize group, :show?`) because
  # Api::V1::GroupDevicesController's actions are also called index/create/
  # destroy — see the policy's own comment.
  describe "#show?" do
    it "allows any active user of an organization to read one of its groups (no in-org roles)" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).show?).to be(true)
    end
  end

  describe "#add_devices?" do
    it "allows any active user of an organization to add devices to its groups (A32)" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).add_devices?).to be(true)
    end
  end

  describe "#remove_device?" do
    it "allows any active user of an organization to remove a device from its groups (A32)" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).remove_device?).to be(true)
    end
  end

  # F8 — same reasoning as #show?/#add_devices? above: authorized explicitly
  # by name at the call site (docs/design/F8-api.md §1).
  describe "#assign_policy?" do
    it "allows any active user of an organization to assign a policy to its groups" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).assign_policy?).to be(true)
    end
  end

  describe "#unassign_policy?" do
    it "allows any active user of an organization to unassign a policy from its groups" do
      group = create(:group, organization: organization)

      expect(described_class.new(user, group).unassign_policy?).to be(true)
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
