require "rails_helper"

RSpec.describe "GET /api/v1/policies/:id/group_assignments", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:policy) { create(:policy, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_assignments(policy_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/policies/#{policy_id}/group_assignments", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication" do
    it "rejects a request with no Authorization header" do
      get_assignments(policy.id, {}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "listing groups assigned this policy (S25)" do
    it "returns only {id, name} for each group assigned this policy" do
      group = create(:group, organization: organization, name: "Sales Laptops")
      create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)
      create(:group, organization: organization, name: "Unrelated Group")

      get_assignments(policy.id)

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([ { "id" => group.id, "name" => "Sales Laptops" } ])
    end

    it "returns an empty list for a policy assigned to no group (A24)" do
      get_assignments(policy.id)

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([])
    end
  end

  describe "pagination" do
    it "paginates using the shared meta shape" do
      create_list(:group, 25, organization: organization).each do |group|
        create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)
      end

      get_assignments(policy.id)

      expect(body["groups"].size).to eq(20)
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 25, "total_pages" => 2
      )
    end
  end

  describe "organization isolation" do
    it "returns 404 for a policy belonging to another organization" do
      foreign_policy = create(:policy, organization: other_organization)

      get_assignments(foreign_policy.id)

      expect(response).to have_http_status(:not_found)
    end

    it "never returns another organization's group even if assigned the same-named policy" do
      other_group = create(:group, organization: other_organization)
      other_policy = create(:policy, organization: other_organization)
      create(:policy_assignment, :for_group, organization: other_organization, policy: other_policy, group: other_group)

      get_assignments(policy.id)

      expect(body["groups"]).to eq([])
    end
  end
end
