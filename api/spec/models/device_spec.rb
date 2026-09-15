require "rails_helper"

RSpec.describe Device, type: :model do
  describe "identifier uniqueness" do
    it "is unique within an Organization" do
      org = create(:organization)
      create(:device, organization: org, identifier: "DEV-0001")

      dup = build(:device, organization: org, identifier: "DEV-0001")

      expect(dup).not_to be_valid
      expect(dup.errors[:identifier]).to be_present
    end

    it "is NOT unique across Organizations (CLAUDE.md §4: unique in-org only, not global)" do
      identifier = "SHARED-0001"
      create(:device, organization: create(:organization), identifier: identifier)

      other_org_device = build(:device, organization: create(:organization), identifier: identifier)

      expect(other_org_device).to be_valid
    end

    it "is enforced by a composite DB index too, not only by the model" do
      org = create(:organization)
      create(:device, organization: org, identifier: "DEV-0001")

      dup = build(:device, organization: org, identifier: "DEV-0001")

      # Skip the model validation to prove the database itself refuses the row.
      expect { dup.save!(validate: false) }.to raise_error(ActiveRecord::RecordNotUnique)
    end
  end

  describe "validations" do
    it "requires an identifier" do
      device = build(:device, identifier: nil)

      expect(device).not_to be_valid
      expect(device.errors[:identifier]).to be_present
    end

    it "requires a name" do
      device = build(:device, name: nil)

      expect(device).not_to be_valid
      expect(device.errors[:name]).to be_present
    end

    it "requires an organization" do
      device = build(:device, organization: nil)

      expect(device).not_to be_valid
      expect(device.errors[:organization]).to be_present
    end

    it "allows a device that has never checked in (no os_version / last_seen_at)" do
      device = build(:device, :never_seen)

      expect(device).to be_valid
    end
  end

  describe "enums" do
    it "exposes exactly the platforms from the PRD" do
      expect(described_class.platforms.keys).to eq(%w[ios android macos])
    end

    it "exposes exactly the statuses from the PRD" do
      expect(described_class.statuses.keys).to eq(%w[active inactive retired])
    end

    it "defaults status to active" do
      expect(create(:device).status).to eq("active")
    end

    it "rejects a platform outside the enum instead of coercing it" do
      expect { build(:device, platform: "windows") }.to raise_error(ArgumentError)
    end

    it "rejects a status outside the enum instead of coercing it" do
      expect { build(:device, status: "deleted") }.to raise_error(ArgumentError)
    end
  end

  describe "organization association" do
    it "is reachable through Organization#devices (the only org-scoped query path)" do
      org = create(:organization)
      mine = create(:device, organization: org)
      create(:device, organization: create(:organization))

      expect(org.devices).to contain_exactly(mine)
    end
  end
end
