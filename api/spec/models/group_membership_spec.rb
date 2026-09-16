require "rails_helper"

RSpec.describe GroupMembership, type: :model do
  let(:organization) { create(:organization) }
  let(:group) { create(:group, organization: organization) }
  let(:device) { create(:device, organization: organization) }

  describe "associations" do
    it "requires a group (Rails 8 belongs_to is required by default)" do
      membership = described_class.new(device: device)

      expect(membership).not_to be_valid
      expect(membership.errors[:group]).to be_present
    end

    it "requires a device" do
      membership = described_class.new(group: group)

      expect(membership).not_to be_valid
      expect(membership.errors[:device]).to be_present
    end

    it "persists a valid pair" do
      membership = described_class.new(group: group, device: device)

      expect(membership.save).to be(true)
    end
  end

  describe "uniqueness of device_id scoped to group_id" do
    it "rejects the same device twice in the same group, without raising" do
      create(:group_membership, group: group, device: device)

      duplicate = described_class.new(group: group, device: device)

      expect(duplicate.save).to be(false)
      expect(duplicate.errors[:device_id]).to be_present
    end

    it "allows the same device in a different group (A24 — a device may belong to many groups)" do
      other_group = create(:group, organization: organization)
      create(:group_membership, group: group, device: device)

      expect(described_class.new(group: other_group, device: device)).to be_valid
    end

    it "allows a different device in the same group" do
      create(:group_membership, group: group, device: device)

      expect(described_class.new(group: group, device: create(:device, organization: organization))).to be_valid
    end

    it "is backed by a composite unique index, which is the only layer upsert_all obeys" do
      create(:group_membership, group: group, device: device)

      # Straight to the DB, bypassing the model exactly the way
      # GroupDevicesController#create does.
      expect {
        described_class.insert!({ group_id: group.id, device_id: device.id, created_at: Time.current, updated_at: Time.current })
      }.to raise_error(ActiveRecord::RecordNotUnique)
    end
  end

  # NOT a missing validation — a deliberate decision recorded in
  # docs/design/F6-db.md §1b. The organization boundary is enforced one layer
  # up (GroupDevicesController filters device ids through
  # current_organization.devices before a row is ever built), because the main
  # write path is upsert_all, which skips every model validation. A validation
  # here would create the illusion of protection on a path it never runs on.
  describe "cross-organization pairs" do
    it "is valid at the model layer even when group and device belong to different organizations" do
      foreign_device = create(:device, organization: create(:organization))

      expect(described_class.new(group: group, device: foreign_device)).to be_valid
    end
  end

  describe "Group#group_memberships, dependent: :delete_all (A20/A21)" do
    it "deletes every membership row when the group is destroyed" do
      create(:group_membership, group: group, device: device)
      create(:group_membership, group: group, device: create(:device, organization: organization))

      expect { group.destroy! }.to change(described_class, :count).from(2).to(0)
    end

    it "does not delete the devices themselves" do
      create(:group_membership, group: group, device: device)

      expect { group.destroy! }.not_to change(Device, :count)
      expect(device.reload).to be_persisted
    end

    it "leaves memberships of OTHER groups untouched" do
      other_group = create(:group, organization: organization)
      create(:group_membership, group: group, device: device)
      survivor = create(:group_membership, group: other_group, device: device)

      group.destroy!

      expect(described_class.all).to contain_exactly(survivor)
    end
  end

  describe "the has_many :through pairs both models gained" do
    it "exposes Group#devices" do
      member = create(:device, organization: organization)
      create(:group_membership, group: group, device: member)
      create(:device, organization: organization)

      expect(group.devices).to contain_exactly(member)
    end

    it "exposes Device#groups, including a device in several groups at once (A24)" do
      other_group = create(:group, organization: organization)
      create(:group_membership, group: group, device: device)
      create(:group_membership, group: other_group, device: device)

      expect(device.groups).to contain_exactly(group, other_group)
    end

    it "returns an empty collection for a device in no group at all (A25)" do
      expect(device.groups).to be_empty
    end
  end
end
