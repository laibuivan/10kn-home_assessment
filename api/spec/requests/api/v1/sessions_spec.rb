require "rails_helper"

RSpec.describe "POST /api/v1/sessions", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }

  def login(email:, password:)
    post "/api/v1/sessions", params: { email: email, password: password }, as: :json
  end

  it "logs in with a valid active account and returns a token + org info" do
    create(:user, organization: organization, email: "admin@acme.example", password: "Password123!")

    login(email: "admin@acme.example", password: "Password123!")

    expect(response).to have_http_status(:created)
    body = response.parsed_body
    expect(body["token"]).to be_present
    expect(body["user"]["email"]).to eq("admin@acme.example")
    expect(body["organization"]["name"]).to eq("Acme Inc.")
  end

  it "rejects the wrong password with the generic message" do
    create(:user, organization: organization, email: "admin@acme.example", password: "Password123!")

    login(email: "admin@acme.example", password: "WrongPassword!")

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("Email hoặc mật khẩu không đúng.")
  end

  it "rejects an email that doesn't exist, with the SAME generic message (no user enumeration)" do
    login(email: "nobody@nowhere.example", password: "whatever123")

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("Email hoặc mật khẩu không đúng.")
  end

  it "rejects an inactive user with the SAME generic message, not a distinct error" do
    create(:user, :inactive, organization: organization, email: "gone@acme.example", password: "Password123!")

    login(email: "gone@acme.example", password: "Password123!")

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("Email hoặc mật khẩu không đúng.")
  end

  it "returns 422 with field errors when email and password are blank" do
    login(email: "", password: "")

    expect(response).to have_http_status(:unprocessable_content)
    errors = response.parsed_body["errors"]
    expect(errors["email"]).to be_present
    expect(errors["password"]).to be_present
  end

  it "authenticates into the correct organization when two orgs share an email (SoT §12 OQ-2)" do
    acme = create(:organization, name: "Acme Inc.")
    globex = create(:organization, name: "Globex Corp.")
    create(:user, organization: acme, email: "shared@example.com", password: "AcmePass123!")
    create(:user, organization: globex, email: "shared@example.com", password: "GlobexPass123!")

    login(email: "shared@example.com", password: "AcmePass123!")

    expect(response).to have_http_status(:created)
    expect(response.parsed_body["organization"]["name"]).to eq("Acme Inc.")
  end

  it "is case-insensitive on the email address" do
    create(:user, organization: organization, email: "admin@acme.example", password: "Password123!")

    login(email: "ADMIN@ACME.example", password: "Password123!")

    expect(response).to have_http_status(:created)
  end
end
