require "rails_helper"

RSpec.describe "GET /api/v1/groups/:id/policy_assignment_jobs", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization) }
  let(:policy) { create(:policy, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_jobs(group_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/groups/#{group_id}/policy_assignment_jobs", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication" do
    it "rejects a request with no Authorization header" do
      get_jobs(group.id, {}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "no job at all (S16, A17)" do
    it "returns 200 with an empty array, not an error" do
      get_jobs(group.id)

      expect(response).to have_http_status(:ok)
      expect(body["policy_assignment_jobs"]).to eq([])
    end
  end

  describe "has a running job (S15, A17)" do
    it "shows the job in the response" do
      job = create(:policy_assignment_job, :running, organization: organization, policy: policy, group: group)

      get_jobs(group.id)

      expect(response).to have_http_status(:ok)
      expect(body["policy_assignment_jobs"].map { |j| j["id"] }).to eq([ job.id ])
      expect(body["policy_assignment_jobs"].first["status"]).to eq("running")
    end
  end

  describe "filtering by status=pending,running" do
    it "returns only jobs matching the comma-separated status list" do
      pending_job = create(:policy_assignment_job, :pending, organization: organization, policy: policy, group: group)
      create(:policy_assignment_job, :done, organization: organization, policy: policy, group: group)

      get_jobs(group.id, { status: "pending,running" })

      expect(body["policy_assignment_jobs"].map { |j| j["id"] }).to eq([ pending_job.id ])
    end

    it "treats an absent status as no filter, returning full history" do
      create(:policy_assignment_job, :done, organization: organization, policy: policy, group: group)
      create(:policy_assignment_job, :failed, organization: organization, policy: policy, group: group)

      get_jobs(group.id)

      expect(body["policy_assignment_jobs"].size).to eq(2)
    end

    it "rejects a status value outside the enum with 422, not 500" do
      get_jobs(group.id, { status: "archived" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
    end

    it "rejects when only one value in a comma list is invalid" do
      get_jobs(group.id, { status: "pending,archived" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
    end
  end

  describe "organization isolation" do
    it "returns 404 for a group belonging to another organization" do
      foreign_group = create(:group, organization: other_organization)

      get_jobs(foreign_group.id)

      expect(response).to have_http_status(:not_found)
    end

    it "never lists a job belonging to a group of the same id in another organization" do
      other_group = create(:group, organization: other_organization)
      create(:policy_assignment_job, organization: other_organization,
             policy: create(:policy, organization: other_organization), group: other_group)

      get_jobs(group.id)

      expect(body["policy_assignment_jobs"]).to eq([])
    end
  end
end
