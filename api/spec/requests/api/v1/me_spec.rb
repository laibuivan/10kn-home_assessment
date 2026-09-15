require "rails_helper"

RSpec.describe "GET /api/v1/me", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization, email: "admin@acme.example") }

  def get_me(token: nil)
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/me", headers: headers
  end

  it "returns the current user and organization for a valid token" do
    token = JsonWebToken.encode(user_id: user.id, organization_id: user.organization_id)

    get_me(token: token)

    expect(response).to have_http_status(:ok)
    body = response.parsed_body
    expect(body["user"]["email"]).to eq("admin@acme.example")
    expect(body["organization"]["name"]).to eq("Acme Inc.")
  end

  it "rejects a request with no Authorization header" do
    get_me

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a malformed Authorization header" do
    get "/api/v1/me", headers: { "Authorization" => "NotBearer garbage" }

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects an expired token" do
    token = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

    get_me(token: token)

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a token for a user who was deactivated after the token was issued" do
    token = JsonWebToken.encode(user_id: user.id, organization_id: user.organization_id)
    user.update!(status: :inactive)

    get_me(token: token)

    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a token for a user that no longer exists" do
    token = JsonWebToken.encode(user_id: user.id, organization_id: user.organization_id)
    User.where(id: user.id).delete_all # raw delete — simulates a stale token for a row that's gone

    get_me(token: token)

    expect(response).to have_http_status(:unauthorized)
  end
end
