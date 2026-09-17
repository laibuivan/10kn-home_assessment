require "rails_helper"

RSpec.describe "POST /api/v1/policies/:id/device_assignments", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:policy) { create(:policy, organization: organization, status: :active) }
  let(:device) { create(:device, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def post_assignment(policy_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/policies/#{policy_id}/device_assignments", params: params, headers: headers, as: :json
  end

  def body
    response.parsed_body
  end

  describe "authentication (S31, A29)" do
    it "rejects a request with no Authorization header" do
      post_assignment(policy.id, { device_id: device.id }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(PolicyAssignment.count).to eq(0)
    end
  end

  describe "happy path — đồng bộ, bounded (§4-B)" do
    it "returns 201 with the serialized device and creates exactly one assignment row" do
      post_assignment(policy.id, { device_id: device.id })

      expect(response).to have_http_status(:created)
      expect(body["device"]["id"]).to eq(device.id)
      expect(PolicyAssignment.where(policy_id: policy.id, device_id: device.id).count).to eq(1)
    end

    it "is idempotent — repeating the same request does not duplicate the row" do
      post_assignment(policy.id, { device_id: device.id })
      post_assignment(policy.id, { device_id: device.id })

      expect(response).to have_http_status(:created)
      expect(PolicyAssignment.where(policy_id: policy.id, device_id: device.id).count).to eq(1)
    end
  end

  describe "organization isolation — 2 phía độc lập (S4, S5, CLAUDE.md §4)" do
    it "returns 404 when the Policy belongs to another organization (S4)" do
      foreign_policy = create(:policy, organization: other_organization, status: :active)

      post_assignment(foreign_policy.id, { device_id: device.id })

      expect(response).to have_http_status(:not_found)
      expect(PolicyAssignment.count).to eq(0)
    end

    it "returns 404 when the Device belongs to another organization, even though the Policy is mine (S5)" do
      foreign_device = create(:device, organization: other_organization)

      post_assignment(policy.id, { device_id: foreign_device.id })

      expect(response).to have_http_status(:not_found)
      expect(PolicyAssignment.count).to eq(0)
    end
  end

  describe "Policy inactive bị chặn (S7, A6, A26)" do
    it "returns 422 and creates nothing" do
      inactive_policy = create(:policy, organization: organization, status: :inactive)

      post_assignment(inactive_policy.id, { device_id: device.id })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ])
      expect(PolicyAssignment.count).to eq(0)
    end
  end

  describe "Device retired bị chặn (S8, A7, A26)" do
    it "returns 422 and creates nothing" do
      retired_device = create(:device, organization: organization, status: :retired)

      post_assignment(policy.id, { device_id: retired_device.id })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ Device::RETIRED_POLICY_MESSAGE ])
      expect(PolicyAssignment.count).to eq(0)
    end
  end
end

RSpec.describe "GET /api/v1/policies/:id/device_assignments", type: :request do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization) }
  let(:policy) { create(:policy, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_assignments(policy_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/policies/#{policy_id}/device_assignments", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  it "lists devices assigned directly to this policy, using the full device shape" do
    device = create(:device, organization: organization, identifier: "ACME-0001")
    create(:policy_assignment, :for_device, organization: organization, policy: policy, device: device)

    get_assignments(policy.id)

    expect(response).to have_http_status(:ok)
    expect(body["devices"].map { |d| d["identifier"] }).to eq([ "ACME-0001" ])
    expect(body["devices"].first.keys).to contain_exactly(
      "id", "identifier", "name", "platform", "os_version", "status", "last_seen_at", "created_at", "updated_at"
    )
  end

  it "includes a retired device that is still directly assigned (A25 — list shows old data)" do
    retired_device = create(:device, organization: organization, status: :retired)
    create(:policy_assignment, :for_device, organization: organization, policy: policy, device: retired_device)

    get_assignments(policy.id)

    expect(body["devices"].map { |d| d["id"] }).to eq([ retired_device.id ])
  end

  it "returns 404 for a policy belonging to another organization" do
    foreign_policy = create(:policy, organization: other_organization)

    get_assignments(foreign_policy.id)

    expect(response).to have_http_status(:not_found)
  end

  it "returns an empty list for a policy with no device directly assigned (A24)" do
    get_assignments(policy.id)

    expect(response).to have_http_status(:ok)
    expect(body["devices"]).to eq([])
  end
end

RSpec.describe "DELETE /api/v1/policies/:id/device_assignments/:device_id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:policy) { create(:policy, organization: organization) }
  let(:device) { create(:device, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def delete_assignment(policy_id, device_id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    delete "/api/v1/policies/#{policy_id}/device_assignments/#{device_id}", headers: headers
  end

  describe "authentication (S31)" do
    it "rejects a request with no Authorization header" do
      create(:policy_assignment, :for_device, organization: organization, policy: policy, device: device)

      delete_assignment(policy.id, device.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "gỡ thành công (S19)" do
    it "removes the assignment and returns 204" do
      create(:policy_assignment, :for_device, organization: organization, policy: policy, device: device)

      delete_assignment(policy.id, device.id)

      expect(response).to have_http_status(:no_content)
      expect(PolicyAssignment.where(policy_id: policy.id, device_id: device.id)).not_to exist
    end
  end

  # docs/design/F8-api.md §2.12 — deliberately different from F6's
  # GroupDevicesController#destroy, which DOES block removing a retired
  # device. F8 SoT §6 only invokes "retired bất biến" for direct assignment,
  # never for unassignment.
  describe "gỡ Policy khỏi Device retired vẫn thành công (khác F6, đọc đúng phạm vi hẹp SoT F8 §6)" do
    it "removes the assignment even though the device is retired" do
      retired_device = create(:device, organization: organization, status: :retired)
      create(:policy_assignment, :for_device, organization: organization, policy: policy, device: retired_device)

      delete_assignment(policy.id, retired_device.id)

      expect(response).to have_http_status(:no_content)
      expect(PolicyAssignment.where(policy_id: policy.id, device_id: retired_device.id)).not_to exist
    end
  end

  describe "404 — liên kết không tồn tại và org sai (2 phía)" do
    it "returns 404 when there is no such assignment at all" do
      delete_assignment(policy.id, device.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 for a policy belonging to another organization" do
      foreign_policy = create(:policy, organization: other_organization)

      delete_assignment(foreign_policy.id, device.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 for a device belonging to another organization" do
      foreign_device = create(:device, organization: other_organization)

      delete_assignment(policy.id, foreign_device.id)

      expect(response).to have_http_status(:not_found)
    end
  end
end
