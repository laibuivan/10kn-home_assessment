require "rails_helper"

RSpec.describe "GET /api/v1/devices/:id/applied_policies", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:device) { create(:device, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_applied_policies(device_id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/devices/#{device_id}/applied_policies", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "happy path — full shape (S2)" do
    it "returns 200 with the full applied_policies shape" do
      group = create(:group, organization: organization, name: "Sales Laptops")
      create(:group_membership, group: group, device: device)
      policy = create(:policy, organization: organization, name: "Security Baseline", type: "wifi", status: :active,
                                configuration: { "ssid" => "Corp-5G" })
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: policy)

      get_applied_policies(device.id)

      expect(response).to have_http_status(:ok)
      expect(body["applied_policies"]).to eq(
        [
          {
            "type" => "wifi",
            "policy" => {
              "id" => policy.id,
              "name" => "Security Baseline",
              "type" => "wifi",
              "configuration" => { "ssid" => "Corp-5G" },
              "status" => "active"
            },
            "source" => { "kind" => "group", "group" => { "id" => group.id, "name" => "Sales Laptops" } },
            "conflict" => false,
            "candidates" => [
              {
                "policy_id" => policy.id,
                "name" => "Security Baseline",
                "configuration" => { "ssid" => "Corp-5G" },
                "status" => "active",
                "source" => { "kind" => "group", "group" => { "id" => group.id, "name" => "Sales Laptops" } },
                "included" => true,
                "excluded_reason" => nil
              }
            ]
          }
        ]
      )
    end
  end

  describe "S1 — empty" do
    it "returns 200 with an empty array when nothing applies" do
      get_applied_policies(device.id)

      expect(response).to have_http_status(:ok)
      expect(body).to eq("applied_policies" => [])
    end
  end

  describe "S14 — Device retired vẫn hiển thị đúng resolution" do
    it "returns the same resolution for a retired device as for an active one" do
      retired_device = create(:device, :retired, organization: organization)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_device, organization: organization, device: retired_device, policy: policy)

      get_applied_policies(retired_device.id)

      expect(response).to have_http_status(:ok)
      expect(body["applied_policies"].map { |e| e["type"] }).to eq([ "wifi" ])
    end
  end

  describe "organization isolation (S15, CLAUDE.md §4 — 404, not 403)" do
    it "returns 404 for a Device belonging to another organization" do
      foreign_device = create(:device, organization: other_organization)

      get_applied_policies(foreign_device.id)

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end
  end

  describe "S16 — Device không tồn tại" do
    it "returns 404" do
      get_applied_policies(999_999)

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "S17 — không token" do
    it "returns 401" do
      get_applied_policies(device.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "S18 — gọi lại 2 lần liên tiếp không đổi state ra kết quả giống hệt" do
    it "returns array-equal response bodies across 2 consecutive calls" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      create(:group_membership, group: group_a, device: device)
      create(:group_membership, group: group_b, device: device)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: policy)
      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: policy)

      get_applied_policies(device.id)
      first_body = body

      get_applied_policies(device.id)
      second_body = body

      expect(first_body).to eq(second_body)
    end
  end

  # Carry-over F8 integration scenarios (S10/S11/S12) — dựng qua HTTP thật,
  # không chỉ unit test service (đã cover ở policy_resolver_spec.rb).
  describe "carry-over F8 — A10: deactivate policy đang thắng biến mất ở lần gọi kế tiếp (S10)" do
    it "no longer lists the policy after it is deactivated" do
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: policy)

      get_applied_policies(device.id)
      expect(body["applied_policies"].map { |e| e["type"] }).to eq([ "wifi" ])

      policy.update!(status: :inactive)

      get_applied_policies(device.id)
      expect(body["applied_policies"]).to eq([])
    end
  end

  describe "carry-over F8 — A11: activate lại xuất hiện lại không cần gán lại (S11)" do
    it "lists the policy again after re-activating it, with no new assignment created" do
      policy = create(:policy, organization: organization, type: "wifi", status: :inactive)
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: policy)

      get_applied_policies(device.id)
      expect(body["applied_policies"]).to eq([])

      policy.update!(status: :active)

      get_applied_policies(device.id)
      expect(body["applied_policies"].map { |e| e["type"] }).to eq([ "wifi" ])
      expect(PolicyAssignment.where(policy_id: policy.id, device_id: device.id).count).to eq(1)
    end
  end

  describe "carry-over F8 — A12: xóa Group xóa luôn policy của group đó khỏi resolution (S12)" do
    it "no longer lists the policy after its only Group is destroyed" do
      group = create(:group, organization: organization)
      create(:group_membership, group: group, device: device)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: policy)

      get_applied_policies(device.id)
      expect(body["applied_policies"].map { |e| e["type"] }).to eq([ "wifi" ])

      group.destroy!

      get_applied_policies(device.id)
      expect(body["applied_policies"]).to eq([])
    end
  end
end
