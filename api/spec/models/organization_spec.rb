require "rails_helper"

RSpec.describe Organization, type: :model do
  it "requires a name" do
    org = Organization.new(name: nil)
    expect(org).not_to be_valid
    expect(org.errors[:name]).to be_present
  end

  it "cannot be destroyed while it still has users (docs/design/F0-db.md §1)" do
    org = create(:organization)
    create(:user, organization: org)

    expect(org.destroy).to be false
    expect(org.errors[:base]).to be_present
    expect(Organization.exists?(org.id)).to be true
  end
end
