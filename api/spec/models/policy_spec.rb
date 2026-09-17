require "rails_helper"

RSpec.describe Policy, type: :model do
  describe "name normalization (docs/design/F7-db.md §1)" do
    it "trims surrounding whitespace before validating and saving" do
      policy = create(:policy, name: "  Password Baseline  ")

      expect(policy.name).to eq("Password Baseline")
    end

    it "rejects a name that is only whitespace, on the name field (S6)" do
      policy = build(:policy, name: "   ")

      expect(policy).not_to be_valid
      expect(policy.errors[:name]).to eq([ Policy::NAME_BLANK_MESSAGE ])
    end

    it "rejects a blank name with the Vietnamese message from the model constant" do
      policy = build(:policy, name: "")

      expect(policy).not_to be_valid
      expect(policy.errors[:name]).to eq([ Policy::NAME_BLANK_MESSAGE ])
    end

    it "treats a nil name as a 422-able validation error, never a NoMethodError" do
      policy = build(:policy, name: nil)

      expect { policy.valid? }.not_to raise_error
      expect(policy).not_to be_valid
      expect(policy.errors[:name]).to eq([ Policy::NAME_BLANK_MESSAGE ])
    end
  end

  describe "type normalization (docs/design/F7-db.md §1)" do
    it "trims surrounding whitespace before validating and saving" do
      policy = create(:policy, type: "  wifi  ")

      expect(policy.type).to eq("wifi")
    end

    it "rejects a type that is only whitespace, on the type field (S12)" do
      policy = build(:policy, type: "   ")

      expect(policy).not_to be_valid
      expect(policy.errors[:type]).to eq([ Policy::TYPE_BLANK_MESSAGE ])
    end

    it "rejects a blank type with the Vietnamese message from the model constant" do
      policy = build(:policy, type: "")

      expect(policy).not_to be_valid
      expect(policy.errors[:type]).to eq([ Policy::TYPE_BLANK_MESSAGE ])
    end

    it "treats a nil type as a 422-able validation error, never a NoMethodError" do
      policy = build(:policy, type: nil)

      expect { policy.valid? }.not_to raise_error
      expect(policy).not_to be_valid
      expect(policy.errors[:type]).to eq([ Policy::TYPE_BLANK_MESSAGE ])
    end
  end

  describe "length limits (S11)" do
    it "accepts a name of exactly 100 characters" do
      expect(build(:policy, name: "a" * 100)).to be_valid
    end

    it "rejects a name longer than 100 characters" do
      policy = build(:policy, name: "a" * 101)

      expect(policy).not_to be_valid
      expect(policy.errors[:name]).to be_present
    end

    it "accepts a type of exactly 100 characters" do
      expect(build(:policy, type: "a" * 100)).to be_valid
    end

    it "rejects a type longer than 100 characters" do
      policy = build(:policy, type: "a" * 101)

      expect(policy).not_to be_valid
      expect(policy.errors[:type]).to be_present
    end
  end

  describe "uniqueness of name, scoped to organization (S7/S8)" do
    it "rejects a duplicate name within the same organization" do
      org = create(:organization)
      create(:policy, organization: org, name: "Password Baseline")

      duplicate = build(:policy, organization: org, name: "Password Baseline")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:name]).to eq([ Policy::NAME_TAKEN_MESSAGE ])
    end

    it "is case-sensitive, so a different-cased name is allowed in the same org" do
      org = create(:organization)
      create(:policy, organization: org, name: "Password Baseline")

      differently_cased = build(:policy, organization: org, name: "password baseline")

      expect(differently_cased).to be_valid
    end

    it "allows the same name across two different organizations" do
      create(:policy, organization: create(:organization), name: "Password Baseline")

      elsewhere = build(:policy, organization: create(:organization), name: "Password Baseline")

      expect(elsewhere).to be_valid
    end

    it "makes the trimmed value the one the composite unique index sees" do
      org = create(:organization)
      create(:policy, organization: org, name: "Password Baseline")

      padded = build(:policy, organization: org, name: "  Password Baseline  ")

      expect(padded).not_to be_valid
      expect(padded.errors[:name]).to eq([ Policy::NAME_TAKEN_MESSAGE ])
    end

    it "allows a record to keep its own existing name on update (S10)" do
      policy = create(:policy, name: "Password Baseline")

      policy.type = "wifi"

      expect(policy).to be_valid
    end
  end

  describe "configuration must be a JSON object (S13/S14)" do
    it "is invalid when configuration is nil" do
      policy = build(:policy, configuration: nil)

      expect(policy).not_to be_valid
      expect(policy.errors[:configuration]).to eq([ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "is invalid when configuration is an array" do
      policy = build(:policy, configuration: [ "a", "b" ])

      expect(policy).not_to be_valid
      expect(policy.errors[:configuration]).to eq([ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "is invalid when configuration is a number" do
      policy = build(:policy, configuration: 5)

      expect(policy).not_to be_valid
      expect(policy.errors[:configuration]).to eq([ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "is invalid when configuration is a plain string" do
      policy = build(:policy, configuration: "raw string")

      expect(policy).not_to be_valid
      expect(policy.errors[:configuration]).to eq([ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "is valid when configuration is an empty Hash" do
      policy = build(:policy, configuration: {})

      expect(policy).to be_valid
    end

    it "is valid when configuration is a populated Hash" do
      policy = build(:policy, configuration: { "ssid" => "Corp", "security" => "wpa2" })

      expect(policy).to be_valid
    end
  end

  describe "status enum (S18/S19)" do
    it "accepts active" do
      policy = build(:policy, status: :active)

      expect(policy).to be_valid
      expect(policy.status).to eq("active")
    end

    it "accepts inactive" do
      policy = build(:policy, status: :inactive)

      expect(policy).to be_valid
      expect(policy.status).to eq("inactive")
    end

    it "defaults to active when not set explicitly" do
      policy = Policy.new(organization: create(:organization), name: "Baseline", type: "wifi", configuration: {})

      expect(policy.status).to eq("active")
    end

    # This is exactly the raw model behaviour the controller-layer
    # `invalid_status?` guard (docs/design/F7-api.md §2.6) exists to prevent
    # from ever reaching ActiveRecord: assigning a string outside the enum
    # map raises ArgumentError, NOT a validation error — it never becomes a
    # 422 on its own. This spec documents that fact so nobody "simplifies"
    # the controller guard away believing the model already handles it.
    it "raises ArgumentError when assigned a status string outside the enum map" do
      expect { build(:policy, status: "archived") }.to raise_error(ArgumentError)
    end
  end

  # docs/design/F7-db.md §1 "[SỬA khi review, 2026-09-17]": `type` collides
  # with Rails' default STI inheritance_column. Without
  # `self.inheritance_column = "_type_disabled"` as the first line of the
  # class body, loading ANY Policy record whose `type` is a realistic
  # business value (not a real Ruby class name) raises
  # ActiveRecord::SubclassNotFound. This is the regression test that would
  # have caught the original draft's wrong risk assessment.
  describe "STI regression guard (docs/design/F7-db.md §1)" do
    it "does not raise ActiveRecord::SubclassNotFound when finding a policy with a realistic type" do
      policy = create(:policy, type: "wifi")

      expect { Policy.find(policy.id) }.not_to raise_error
    end

    it "does not raise when loading via Organization#policies.all" do
      org = create(:organization)
      create(:policy, organization: org, type: "password_baseline")
      create(:policy, organization: org, type: "vpn")

      expect { org.policies.all.to_a }.not_to raise_error
    end

    it "does not raise on #reload" do
      policy = create(:policy, type: "wifi")

      expect { policy.reload }.not_to raise_error
    end

    it "reads back the exact type string, not a constantized class" do
      policy = create(:policy, type: "wifi")

      expect(policy.reload.type).to eq("wifi")
    end
  end
end
