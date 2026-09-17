require "rails_helper"

RSpec.describe "GET /api/v1/policy_assignment_jobs/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization) }
  let(:policy) { create(:policy, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_job(id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/policy_assignment_jobs/#{id}", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication" do
    it "rejects a request with no Authorization header" do
      job = create(:policy_assignment_job, organization: organization, policy: policy, group: group)

      get_job(job.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "reading a job of my own organization" do
    it "returns 200 with the job's current status" do
      job = create(:policy_assignment_job, :running, organization: organization, policy: policy, group: group,
                                                       total_count: 5)

      get_job(job.id)

      expect(response).to have_http_status(:ok)
      expect(body["policy_assignment_job"]).to include("id" => job.id, "status" => "running", "total_count" => 5)
    end
  end

  describe "org khác → 404 (S13, A15)" do
    it "returns 404 for a job belonging to another organization" do
      foreign_job = create(:policy_assignment_job, organization: other_organization,
                            policy: create(:policy, organization: other_organization),
                            group: create(:group, organization: other_organization))

      get_job(foreign_job.id)

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "id không tồn tại → 404 (S14, A16)" do
    it "returns 404" do
      get_job(999_999_999)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not 500, for a malformed id" do
      get_job("abc")

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "job sau khi Group bị xóa (S12, docs/design/F8-db.md §1c)" do
    it "still returns 200 with group: null and status: failed, not 404" do
      job = create(:policy_assignment_job, :pending, organization: organization, policy: policy, group: group)

      group.destroy!

      get_job(job.id)

      expect(response).to have_http_status(:ok)
      expect(body["policy_assignment_job"]["status"]).to eq("failed")
      expect(body["policy_assignment_job"]["group"]).to be_nil
      expect(body["policy_assignment_job"]["error_message"]).to eq(PolicyAssignmentJob::GROUP_DELETED_MESSAGE)
    end

    it "still exposes the policy summary even though the group is gone" do
      job = create(:policy_assignment_job, :running, organization: organization, policy: policy, group: group)

      group.destroy!

      get_job(job.id)

      expect(body["policy_assignment_job"]["policy"]).to eq("id" => policy.id, "name" => policy.name)
    end
  end
end
