require "rails_helper"

RSpec.describe User, type: :model do
  describe "email uniqueness" do
    it "is unique within an Organization" do
      org = create(:organization)
      create(:user, organization: org, email: "dup@example.com")

      dup = build(:user, organization: org, email: "dup@example.com")

      expect(dup).not_to be_valid
      expect(dup.errors[:email]).to be_present
    end

    it "is NOT unique across Organizations (PRD: unique in-org only, not global)" do
      email = "shared@example.com"
      create(:user, organization: create(:organization), email: email)
      other_org_user = build(:user, organization: create(:organization), email: email)

      expect(other_org_user).to be_valid
    end

    it "normalizes email to lowercase before validating, so case can't bypass uniqueness" do
      org = create(:organization)
      create(:user, organization: org, email: "Same@Example.com")

      dup = build(:user, organization: org, email: "same@example.com")

      expect(dup).not_to be_valid
    end

    it "stores the normalized (lowercase) email, not the input casing" do
      user = create(:user, email: "Mixed.Case@Example.com")
      expect(user.email).to eq("mixed.case@example.com")
    end
  end

  describe "status" do
    it "defaults to active" do
      expect(create(:user).status).to eq("active")
    end

    it "authenticates with the correct password regardless of status" do
      user = create(:user, :inactive, password: "Password123!")
      expect(user.authenticate("Password123!")).to eq(user)
      # Blocking inactive users from logging in is enforced at the
      # controller layer (Api::V1::SessionsController), not the model —
      # `authenticate` itself is a pure password check.
    end
  end

  describe "password" do
    it "requires at least 8 characters" do
      user = build(:user, password: "short")
      expect(user).not_to be_valid
      expect(user.errors[:password]).to be_present
    end
  end
end
