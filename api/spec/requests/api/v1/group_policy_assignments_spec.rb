require "rails_helper"

RSpec.describe "POST /api/v1/groups/:id/policy_assignments", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization, name: "Sales Laptops") }
  let(:policy) { create(:policy, organization: organization, name: "Security Baseline", status: :active) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def post_assignment(group_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/groups/#{group_id}/policy_assignments", params: params, headers: headers, as: :json
  end

  def body
    response.parsed_body
  end

  describe "authentication (S30, A29)" do
    it "rejects a request with no Authorization header" do
      post_assignment(group.id, { policy_id: policy.id }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(PolicyAssignmentJob.count).to eq(0)
    end
  end

  describe "happy path — Group nhỏ, chạy async, hoàn thành (S1)" do
    it "returns 202 with a pending job, then done once the job runs (perform_enqueued_jobs)" do
      device = create(:device, organization: organization)
      create(:group_membership, group: group, device: device)

      perform_enqueued_jobs do
        post_assignment(group.id, { policy_id: policy.id })
      end

      expect(response).to have_http_status(:accepted)
      job = PolicyAssignmentJob.find(body["policy_assignment_job"]["id"])
      expect(job.status).to eq("done")
      expect(group.policy_assignments.where(policy_id: policy.id)).to exist
    end

    it "sets total_count from the group's device count at enqueue time" do
      create_list(:device, 3, organization: organization).each { |d| create(:group_membership, group: group, device: d) }

      post_assignment(group.id, { policy_id: policy.id })

      expect(body["policy_assignment_job"]["total_count"]).to eq(3)
      expect(body["policy_assignment_job"]["status"]).to eq("pending")
    end

    it "serializes the job with policy/group summaries and no organization_id" do
      post_assignment(group.id, { policy_id: policy.id })

      job_json = body["policy_assignment_job"]
      expect(job_json.keys).to contain_exactly(
        "id", "status", "total_count", "processed_count", "error_message", "policy", "group",
        "created_at", "updated_at"
      )
      expect(job_json["policy"]).to eq("id" => policy.id, "name" => policy.name)
      expect(job_json["group"]).to eq("id" => group.id, "name" => group.name)
    end
  end

  describe "organization isolation — 2 phía độc lập (S2, S3, CLAUDE.md §4)" do
    it "returns 404 when the Group belongs to another organization (S2)" do
      foreign_group = create(:group, organization: other_organization)

      post_assignment(foreign_group.id, { policy_id: policy.id })

      expect(response).to have_http_status(:not_found)
      expect(PolicyAssignmentJob.count).to eq(0)
    end

    it "returns 404 when the Policy belongs to another organization, even though the Group is mine (S3)" do
      foreign_policy = create(:policy, organization: other_organization, status: :active)

      post_assignment(group.id, { policy_id: foreign_policy.id })

      expect(response).to have_http_status(:not_found)
      expect(PolicyAssignmentJob.count).to eq(0)
    end
  end

  describe "Policy inactive bị chặn (S6, A5, A26)" do
    it "returns 422 and does not enqueue anything" do
      inactive_policy = create(:policy, organization: organization, status: :inactive)

      post_assignment(group.id, { policy_id: inactive_policy.id })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ Policy::INACTIVE_ASSIGNMENT_MESSAGE ])
      expect(PolicyAssignmentJob.count).to eq(0)
    end
  end

  describe "idempotent — không tạo trùng (S10, S11)" do
    it "assigning the same (policy, group) pair 3 times leaves exactly one policy_assignment row" do
      3.times do
        perform_enqueued_jobs do
          post_assignment(group.id, { policy_id: policy.id })
        end
      end

      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id).count).to eq(1)
    end
  end

  describe "dedupe (OQ-5) — 2 request liên tiếp khi job đầu còn pending/running" do
    it "returns the SAME job id for a second request while the first is still pending" do
      post_assignment(group.id, { policy_id: policy.id })
      first_job_id = body["policy_assignment_job"]["id"]

      post_assignment(group.id, { policy_id: policy.id })

      expect(response).to have_http_status(:accepted)
      expect(body["policy_assignment_job"]["id"]).to eq(first_job_id)
      expect(PolicyAssignmentJob.count).to eq(1)
    end

    it "creates a NEW job once the previous one has finished (A13)" do
      perform_enqueued_jobs do
        post_assignment(group.id, { policy_id: policy.id })
      end
      first_job_id = body["policy_assignment_job"]["id"]

      post_assignment(group.id, { policy_id: policy.id })

      expect(body["policy_assignment_job"]["id"]).not_to eq(first_job_id)
      expect(PolicyAssignmentJob.count).to eq(2)
    end
  end
end

RSpec.describe "GET /api/v1/groups/:id/policy_assignments", type: :request do
  let(:organization) { create(:organization) }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization) }
  let(:group) { create(:group, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_assignments(group_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/groups/#{group_id}/policy_assignments", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  it "lists only the policies assigned to this group, minimal fields" do
    policy = create(:policy, organization: organization, name: "Security Baseline", type: "wifi")
    create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)
    create(:policy, organization: organization, name: "Unrelated")

    get_assignments(group.id)

    expect(response).to have_http_status(:ok)
    expect(body["policies"].size).to eq(1)
    expect(body["policies"].first.keys).to contain_exactly("id", "name", "type", "status")
    expect(body["policies"].first["name"]).to eq("Security Baseline")
  end

  it "returns 404 for a group belonging to another organization" do
    foreign_group = create(:group, organization: other_organization)

    get_assignments(foreign_group.id)

    expect(response).to have_http_status(:not_found)
  end

  it "returns an empty list for a group with no policy assigned" do
    get_assignments(group.id)

    expect(response).to have_http_status(:ok)
    expect(body["policies"]).to eq([])
  end
end

RSpec.describe "DELETE /api/v1/groups/:id/policy_assignments/:policy_id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization) }
  let(:policy) { create(:policy, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def delete_assignment(group_id, policy_id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    delete "/api/v1/groups/#{group_id}/policy_assignments/#{policy_id}", headers: headers
  end

  describe "authentication (S30)" do
    it "rejects a request with no Authorization header" do
      create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)

      delete_assignment(group.id, policy.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "gỡ thành công (S18)" do
    it "removes the assignment and returns 204" do
      create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)

      delete_assignment(group.id, policy.id)

      expect(response).to have_http_status(:no_content)
      expect(PolicyAssignment.where(policy_id: policy.id, group_id: group.id)).not_to exist
    end
  end

  describe "RBAC — user khác trong org vẫn gỡ được (S32, A31)" do
    it "lets a different user in the same organization remove an assignment created by someone else" do
      create(:policy_assignment, :for_group, organization: organization, policy: policy, group: group)

      delete_assignment(group.id, policy.id, token: token_for(other_user))

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "404 — liên kết không tồn tại (OQ-4) và org sai (2 phía)" do
    it "returns 404 when the group has no such policy assignment at all" do
      delete_assignment(group.id, policy.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 for a group belonging to another organization" do
      foreign_group = create(:group, organization: other_organization)

      delete_assignment(foreign_group.id, policy.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 for a policy belonging to another organization" do
      foreign_policy = create(:policy, organization: other_organization)

      delete_assignment(group.id, foreign_policy.id)

      expect(response).to have_http_status(:not_found)
    end
  end
end
