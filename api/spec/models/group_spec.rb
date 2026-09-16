require "rails_helper"

RSpec.describe Group, type: :model do
  describe "name normalization (docs/design/F5-db.md §1b)" do
    it "trims surrounding whitespace before validating and saving" do
      group = create(:group, name: "  Sales Team  ")

      expect(group.name).to eq("Sales Team")
    end

    it "rejects a name that is only whitespace, on the name field (A4)" do
      group = build(:group, name: "   ")

      expect(group).not_to be_valid
      expect(group.errors[:name]).to eq([ Group::NAME_BLANK_MESSAGE ])
    end

    it "rejects a blank name with the Vietnamese message from the model constant" do
      group = build(:group, name: "")

      expect(group).not_to be_valid
      expect(group.errors[:name]).to eq([ Group::NAME_BLANK_MESSAGE ])
    end

    it "treats a nil name as a 422-able validation error, never a NoMethodError" do
      group = build(:group, name: nil)

      expect { group.valid? }.not_to raise_error
      expect(group).not_to be_valid
      expect(group.errors[:name]).to eq([ Group::NAME_BLANK_MESSAGE ])
    end

    it "makes the trimmed value the one the composite unique index sees" do
      org = create(:organization)
      create(:group, organization: org, name: "Sales Team")

      padded = build(:group, organization: org, name: "  Sales Team  ")

      expect(padded).not_to be_valid
      expect(padded.errors[:name]).to eq([ Group::NAME_TAKEN_MESSAGE ])
    end
  end

  describe "description normalization (A25)" do
    it "stores an empty string as NULL" do
      group = create(:group, description: "")

      expect(group.description).to be_nil
    end

    it "stores a whitespace-only description as NULL" do
      group = create(:group, description: "   ")

      expect(group.description).to be_nil
    end

    it "keeps an explicit nil as NULL" do
      group = create(:group, :without_description)

      expect(group.description).to be_nil
    end

    it "trims a real description instead of dropping it" do
      group = create(:group, description: "  Máy của đội kinh doanh  ")

      expect(group.description).to eq("Máy của đội kinh doanh")
    end
  end

  describe "length limits (A10)" do
    it "accepts a name of exactly 100 characters" do
      expect(build(:group, name: "a" * 100)).to be_valid
    end

    it "rejects a name longer than 100 characters" do
      group = build(:group, name: "a" * 101)

      expect(group).not_to be_valid
      expect(group.errors[:name]).to be_present
    end

    it "measures the name length after trimming, not before" do
      expect(build(:group, name: "  #{'a' * 100}  ")).to be_valid
    end

    it "accepts a description of exactly 500 characters" do
      expect(build(:group, description: "b" * 500)).to be_valid
    end

    it "rejects a description longer than 500 characters" do
      group = build(:group, description: "b" * 501)

      expect(group).not_to be_valid
      expect(group.errors[:description]).to be_present
    end

    it "does not trip the description length validator on NULL" do
      expect(build(:group, :without_description)).to be_valid
    end
  end

  describe "name uniqueness" do
    it "is unique within an Organization (A5)" do
      org = create(:organization)
      create(:group, organization: org, name: "Sales Team")

      dup = build(:group, organization: org, name: "Sales Team")

      expect(dup).not_to be_valid
      expect(dup.errors[:name]).to eq([ Group::NAME_TAKEN_MESSAGE ])
    end

    it "is NOT unique across Organizations (CLAUDE.md §4, A6)" do
      create(:group, organization: create(:organization), name: "Sales Team")

      other_org_group = build(:group, organization: create(:organization), name: "Sales Team")

      expect(other_org_group).to be_valid
    end

    it "is case-sensitive, so 'Sales Team' and 'sales team' coexist in one org (F5-db.md §4c)" do
      org = create(:organization)
      create(:group, organization: org, name: "Sales Team")

      lowercased = build(:group, organization: org, name: "sales team")

      expect(lowercased).to be_valid
    end

    it "lets a record keep its own name on update (A8)" do
      group = create(:group, name: "Sales Team")

      expect(group.update(description: "Đội kinh doanh")).to be(true)
      expect(group.reload.name).to eq("Sales Team")
    end

    it "is enforced by a composite DB index too, not only by the model (A7)" do
      org = create(:organization)
      create(:group, organization: org, name: "Sales Team")

      dup = build(:group, organization: org, name: "Sales Team")

      # Skip the model validation to prove the database itself refuses the row.
      expect { dup.save(validate: false) }.to raise_error(ActiveRecord::RecordNotUnique)
    end
  end

  describe "organization association" do
    it "requires an organization (no orphan groups — CLAUDE.md §4)" do
      group = build(:group, organization: nil)

      expect(group).not_to be_valid
      expect(group.errors[:organization]).to be_present
    end

    it "is reachable from the organization side" do
      org = create(:organization)
      group = create(:group, organization: org)

      expect(org.groups).to contain_exactly(group)
    end
  end
end
