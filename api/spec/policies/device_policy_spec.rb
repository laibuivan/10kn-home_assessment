require "rails_helper"

RSpec.describe DevicePolicy, type: :policy do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }

  describe "#index?" do
    it "allows any active user of an organization to list devices (no in-org roles)" do
      expect(described_class.new(user, Device).index?).to be(true)
    end
  end

  describe "#create?" do
    it "allows any active user of an organization to create a device (no in-org roles)" do
      expect(described_class.new(user, Device).create?).to be(true)
    end
  end

  describe "#update?" do
    it "allows any active user of an organization to update a device (no in-org roles)" do
      device = create(:device, organization: organization)

      expect(described_class.new(user, device).update?).to be(true)
    end

    it "is true even for a retired device — the retired-immutable rule lives in the model, not Pundit" do
      device = create(:device, :retired, organization: organization)

      expect(described_class.new(user, device).update?).to be(true)
    end
  end

  describe "Scope" do
    subject(:resolved) { described_class::Scope.new(user, Device).resolve }

    it "resolves only the devices of the user's own organization" do
      mine = create(:device, organization: organization)
      create(:device, organization: create(:organization))

      expect(resolved).to contain_exactly(mine)
    end

    it "never leaks another organization's devices, not even in the count" do
      create_list(:device, 2, organization: organization)
      create_list(:device, 5, organization: create(:organization))

      expect(resolved.count).to eq(2)
    end

    it "resolves nothing for an organization with no devices of its own" do
      create_list(:device, 3, organization: create(:organization))

      expect(resolved).to be_empty
    end
  end

  describe ApplicationPolicy::Scope do
    it "refuses to guess a default scope (subclasses must be explicit)" do
      expect { described_class.new(nil, Device).resolve }.to raise_error(NotImplementedError)
    end
  end
end
