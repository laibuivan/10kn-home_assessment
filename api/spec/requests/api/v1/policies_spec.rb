require "rails_helper"

RSpec.describe "GET /api/v1/policies", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_policies(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/policies", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (S28/A26)" do
    it "rejects a request with no Authorization header" do
      get_policies({}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_policies({}, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects a token belonging to a user who has been deactivated" do
      token = token_for(user)
      user.update!(status: :inactive)

      get_policies({}, token: token)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "the default listing" do
    it "returns the first page of the organization's policies with pagination metadata" do
      create_list(:policy, 25, organization: organization)

      get_policies

      expect(response).to have_http_status(:ok)
      expect(body["policies"].size).to eq(20)
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 25, "total_pages" => 2
      )
    end

    it "serializes exactly the seven fields the list screen needs" do
      policy = create(:policy, organization: organization, name: "Password Baseline", type: "password",
                                configuration: { "min_length" => 12 }, status: :active)

      get_policies

      expect(body["policies"].first.keys).to contain_exactly(
        "id", "name", "type", "configuration", "status", "created_at", "updated_at"
      )
      expect(body["policies"].first).to include(
        "id" => policy.id, "name" => "Password Baseline", "type" => "password",
        "configuration" => { "min_length" => 12 }, "status" => "active"
      )
    end

    it "never exposes organization_id" do
      create(:policy, organization: organization)

      get_policies

      expect(body["policies"].first).not_to have_key("organization_id")
    end

    it "never exposes assignments_count (SoT OQ-6, S31 — no policy_assignments table at F7)" do
      create(:policy, organization: organization)

      get_policies

      expect(body["policies"].first).not_to have_key("assignments_count")
    end

    it "sorts by created_at DESC then id DESC, so the newest policy is first" do
      older = create(:policy, organization: organization, name: "Older", created_at: 2.days.ago)
      newest = create(:policy, organization: organization, name: "Newest", created_at: 1.hour.ago)

      get_policies

      expect(body["policies"].map { |p| p["id"] }).to eq([ newest.id, older.id ])
    end

    it "breaks a created_at tie by id DESC, so the order is deterministic" do
      same_time = 1.hour.ago
      first = create(:policy, organization: organization, created_at: same_time)
      second = create(:policy, organization: organization, created_at: same_time)

      get_policies

      expect(body["policies"].map { |p| p["id"] }).to eq([ second.id, first.id ])
    end

    it "returns an empty list with zeroed meta for an organization with no policies (S20)" do
      create_list(:policy, 3, organization: other_organization)

      get_policies

      expect(response).to have_http_status(:ok)
      expect(body["policies"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 0, "total_pages" => 0
      )
    end
  end

  describe "organization isolation (S1, CLAUDE.md §4)" do
    it "never returns another organization's policies" do
      mine = create(:policy, organization: organization, name: "Mine")
      create(:policy, organization: other_organization, name: "Theirs")

      get_policies

      expect(body["policies"].map { |p| p["name"] }).to eq([ "Mine" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "lets two organizations reuse the same policy name without collision (S8)" do
      create(:policy, organization: organization, name: "Password Baseline")
      create(:policy, organization: other_organization, name: "Password Baseline")
      other_user = create(:user, organization: other_organization)

      get_policies
      expect(body["meta"]["total_count"]).to eq(1)

      get_policies({}, token: token_for(other_user))
      expect(body["meta"]["total_count"]).to eq(1)
    end
  end

  describe "pagination (S23/S24/S25)" do
    it "returns the requested page" do
      create_list(:policy, 25, organization: organization)

      get_policies({ page: 2 })

      expect(body["policies"].size).to eq(5)
      expect(body["meta"]["current_page"]).to eq(2)
    end

    it "returns 200 with an empty list for a page past the end (S23)" do
      create_list(:policy, 3, organization: organization)

      get_policies({ page: 99 })

      expect(response).to have_http_status(:ok)
      expect(body["policies"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 99, "per_page" => 20, "total_count" => 3, "total_pages" => 1
      )
    end

    it "rejects a non-integer page and a non-positive per_page together in one response (S24)" do
      get_policies({ page: "abc", per_page: 0 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "page" => [ "must be a positive integer" ],
        "per_page" => [ "must be a positive integer" ]
      )
    end

    it "rejects invalid pagination before it ever queries the database" do
      create(:policy, organization: organization)

      expect_any_instance_of(PolicyPolicy::Scope).not_to receive(:resolve)

      get_policies({ page: "0" })

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "clamps per_page to the maximum instead of erroring, and reports the clamped value (S25)" do
      create_list(:policy, 3, organization: organization)

      get_policies({ per_page: 999 })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]["per_page"]).to eq(100)
    end

    it "treats absent pagination params as the defaults, not as errors" do
      get_policies

      expect(response).to have_http_status(:ok)
      expect(body["meta"]).to include("current_page" => 1, "per_page" => 20)
    end
  end

  describe "search by name (S21)" do
    it "matches a partial name, case-insensitively" do
      create(:policy, organization: organization, name: "Password Baseline")
      create(:policy, organization: organization, name: "VPN Config")

      get_policies({ q: "pAsSwOrD" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "Password Baseline" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "returns an empty list with a zeroed total when nothing matches (S21)" do
      create(:policy, organization: organization, name: "Password Baseline")

      get_policies({ q: "zzzz" })

      expect(response).to have_http_status(:ok)
      expect(body["policies"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
      expect(body["meta"]["total_pages"]).to eq(0)
    end

    it "treats a blank q as no filter at all" do
      create_list(:policy, 2, organization: organization)

      get_policies({ q: "" })

      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "treats a whitespace-only q as no filter, not as an error" do
      create_list(:policy, 2, organization: organization)

      get_policies({ q: "   " })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "trims q before matching" do
      create(:policy, organization: organization, name: "Password Baseline")
      create(:policy, organization: organization, name: "VPN Config")

      get_policies({ q: "  password  " })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "Password Baseline" ])
    end

    it "never leaks another organization's policies through the search" do
      create(:policy, organization: other_organization, name: "Password Baseline")

      get_policies({ q: "password" })

      expect(body["policies"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
    end

    # sanitize_sql_like safety — without it, % and _ typed by the user become
    # LIKE wildcards and a SQL-injection attempt could leak rows.
    it "treats % typed by the user as a literal percent sign, not a wildcard" do
      create(:policy, organization: organization, name: "100% Compliant")
      create(:policy, organization: organization, name: "Password Baseline")
      create(:policy, organization: organization, name: "VPN_Config")

      get_policies({ q: "100%" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "100% Compliant" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "does not turn a lone % into 'match everything'" do
      create(:policy, organization: organization, name: "100% Compliant")
      create(:policy, organization: organization, name: "Password Baseline")

      get_policies({ q: "%" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "100% Compliant" ])
    end

    it "treats _ typed by the user as a literal underscore, not a single-char wildcard" do
      create(:policy, organization: organization, name: "100% Compliant")
      create(:policy, organization: organization, name: "VPN_Config")

      get_policies({ q: "_" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "VPN_Config" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "treats a SQL-injection attempt as an ordinary search string, without raising or leaking rows" do
      create_list(:policy, 3, organization: organization)

      get_policies({ q: "' OR 1=1 --" })

      expect(response).to have_http_status(:ok)
      expect(body["policies"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
      expect(Policy.count).to eq(3)
    end
  end

  describe "filtering by status (S22/S26)" do
    it "filters to only active policies" do
      create(:policy, organization: organization, name: "Active One", status: :active)
      create(:policy, organization: organization, name: "Inactive One", status: :inactive)

      get_policies({ status: "active" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "Active One" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "filters to only inactive policies" do
      create(:policy, organization: organization, name: "Active One", status: :active)
      create(:policy, organization: organization, name: "Inactive One", status: :inactive)

      get_policies({ status: "inactive" })

      expect(body["policies"].map { |p| p["name"] }).to eq([ "Inactive One" ])
    end

    it "treats an absent status as no filter" do
      create(:policy, organization: organization, status: :active)
      create(:policy, organization: organization, status: :inactive)

      get_policies

      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "rejects a status filter outside the enum with 422, not 500 (S26)" do
      create(:policy, organization: organization)

      get_policies({ status: "archived" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
    end

    it "combines an invalid status with invalid pagination in one 422 response" do
      get_policies({ status: "archived", page: "abc" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].keys).to contain_exactly("status", "page")
    end

    it "never queries the database when the status filter is invalid" do
      create(:policy, organization: organization)

      expect_any_instance_of(PolicyPolicy::Scope).not_to receive(:resolve)

      get_policies({ status: "archived" })

      expect(response).to have_http_status(:unprocessable_content)
    end
  end
end

RSpec.describe "GET /api/v1/policies/:id — no such route (SoT OQ-7, docs/design/F7-api.md §2.5)", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  # docs/design/F7-api.md §2.5: there is intentionally no `show` route, so
  # this request never reaches a controller — it hits
  # ActionController::RoutingError at the routing layer, before
  # Authenticatable/Pundit/ApplicationController's rescue_from ever run. The
  # body is not the app's stable {"error": "Not found"} envelope (it differs
  # between test/dev — leaking the exception class + backtrace — and
  # production), so these specs assert status ONLY, per the plan's explicit
  # instruction not to assert response.parsed_body here.
  def get_policy(id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/policies/#{id}", headers: headers
  end

  it "returns 404 for a policy belonging to another organization (S2)" do
    foreign = create(:policy, organization: other_organization)

    get_policy(foreign.id)

    expect(response).to have_http_status(:not_found)
  end

  it "returns 404 for an id that does not exist (S4)" do
    get_policy(999_999_999)

    expect(response).to have_http_status(:not_found)
  end

  it "returns 404, not a 500, for a malformed id (S5)" do
    get_policy("abc")

    expect(response).to have_http_status(:not_found)
  end
end

RSpec.describe "POST /api/v1/policies", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def post_policy(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/policies", params: params, headers: headers, as: :json
  end

  def body
    response.parsed_body
  end

  describe "authentication (S28)" do
    it "rejects a request with no Authorization header" do
      post_policy({ name: "Password Baseline", type: "password", configuration: { min_length: 12 } }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(Policy.count).to eq(0)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      post_policy({ name: "Password Baseline", type: "password", configuration: {} }, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(Policy.count).to eq(0)
    end
  end

  describe "creating successfully" do
    it "returns 201 with exactly the seven serialized fields" do
      post_policy({ name: "Password Baseline", type: "password", configuration: { min_length: 12 } })

      expect(response).to have_http_status(:created)
      expect(body["policy"].keys).to contain_exactly(
        "id", "name", "type", "configuration", "status", "created_at", "updated_at"
      )
      expect(body["policy"]).to include(
        "name" => "Password Baseline", "type" => "password", "configuration" => { "min_length" => 12 }
      )
    end

    it "persists the policy in the caller's own organization" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(organization.policies.count).to eq(1)
      expect(Policy.find(body["policy"]["id"]).organization).to eq(organization)
    end

    it "trims name and type before storing them" do
      post_policy({ name: "  Password Baseline  ", type: "  password  ", configuration: {} })

      expect(body["policy"]["name"]).to eq("Password Baseline")
      expect(body["policy"]["type"]).to eq("password")
    end

    it "accepts a name and type of exactly 100 characters" do
      post_policy({ name: "a" * 100, type: "b" * 100, configuration: {} })

      expect(response).to have_http_status(:created)
    end

    it "accepts an empty object as a valid configuration" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(response).to have_http_status(:created)
      expect(body["policy"]["configuration"]).to eq({})
    end

    it "allows the same name as a policy in ANOTHER organization (S8)" do
      create(:policy, organization: other_organization, name: "Password Baseline")

      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(response).to have_http_status(:created)
    end
  end

  describe "status defaults and enum guard (S18/S19)" do
    it "defaults to active when status is not provided (S18)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(response).to have_http_status(:created)
      expect(body["policy"]["status"]).to eq("active")
    end

    it "accepts an explicit status of inactive" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {}, status: "inactive" })

      expect(response).to have_http_status(:created)
      expect(body["policy"]["status"]).to eq("inactive")
    end

    it "rejects a status outside the enum with 422, not 500 (S19)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {}, status: "archived" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
      expect(Policy.count).to eq(0)
    end
  end

  describe "validation" do
    it "rejects a blank name on the name field (S6)" do
      post_policy({ name: "", type: "password", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_BLANK_MESSAGE ])
      expect(Policy.count).to eq(0)
    end

    it "rejects a whitespace-only name on the name field (S6)" do
      post_policy({ name: "   ", type: "password", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_BLANK_MESSAGE ])
    end

    it "rejects a blank type on the type field (S12)" do
      post_policy({ name: "Password Baseline", type: "", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("type" => [ Policy::TYPE_BLANK_MESSAGE ])
      expect(Policy.count).to eq(0)
    end

    it "rejects a missing configuration key entirely (S13)" do
      post_policy({ name: "Password Baseline", type: "password" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
      expect(Policy.count).to eq(0)
    end

    it "rejects a null configuration (S13)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: nil })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "rejects a configuration that is an array (S14)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: [ "a", "b" ] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "rejects a configuration that is a plain string (S14)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: "not an object" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "rejects a configuration that is a number (S14)" do
      post_policy({ name: "Password Baseline", type: "password", configuration: 5 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "rejects a name longer than 100 characters (S11)" do
      post_policy({ name: "a" * 101, type: "password", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("name")
    end

    it "rejects a type longer than 100 characters (S11)" do
      post_policy({ name: "Password Baseline", type: "a" * 101, configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("type")
    end

    it "rejects a duplicate name inside the same organization (S7)" do
      create(:policy, organization: organization, name: "Password Baseline")

      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_TAKEN_MESSAGE ])
      expect(organization.policies.count).to eq(1)
    end

    it "reports every failing field in one response" do
      post_policy({ name: "", type: "" })

      expect(body["errors"].keys).to contain_exactly("name", "type", "configuration")
    end

    # S9 — the loser of a create race never sees its own uniqueness check
    # fail, it hits the composite unique index instead. The client must not
    # be able to tell that apart from S7 above (1 x 201 + 1 x 422, not 500).
    it "turns a DB-level unique-index violation into the same 422, not a 500 (S9)" do
      create(:policy, organization: organization, name: "Password Baseline")
      # Simulate losing the race: the app-level uniqueness check passes (the
      # competing row was not visible yet) and the INSERT hits the index.
      allow_any_instance_of(Policy).to receive(:valid?).and_return(true)

      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_TAKEN_MESSAGE ])
    end
  end

  describe "organization_id cannot be overridden (A28)" do
    it "ignores an organization_id in the body and uses the token's organization" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {},
                    organization_id: other_organization.id })

      expect(response).to have_http_status(:created)
      expect(Policy.find(body["policy"]["id"]).organization).to eq(organization)
      expect(other_organization.policies.count).to eq(0)
    end

    it "never serializes organization_id back to the client" do
      post_policy({ name: "Password Baseline", type: "password", configuration: {} })

      expect(body["policy"]).not_to have_key("organization_id")
    end
  end
end

RSpec.describe "PATCH /api/v1/policies/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def patch_policy(id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    patch "/api/v1/policies/#{id}", params: params, headers: headers, as: :json
  end

  def body
    response.parsed_body
  end

  describe "authentication (S28)" do
    it "rejects a request with no Authorization header" do
      policy = create(:policy, organization: organization, name: "Password Baseline")

      patch_policy(policy.id, { name: "Renamed" }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(policy.reload.name).to eq("Password Baseline")
    end

    it "rejects an expired token" do
      policy = create(:policy, organization: organization, name: "Password Baseline")
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      patch_policy(policy.id, { name: "Renamed" }, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(policy.reload.name).to eq("Password Baseline")
    end
  end

  describe "updating successfully" do
    it "updates name, type, configuration and status together and returns 200" do
      policy = create(:policy, organization: organization, name: "Password Baseline", type: "password")

      patch_policy(policy.id, { name: "Password Strict", type: "password_v2",
                                configuration: { "min_length" => 16 }, status: "inactive" })

      expect(response).to have_http_status(:ok)
      expect(body["policy"]).to include(
        "name" => "Password Strict", "type" => "password_v2",
        "configuration" => { "min_length" => 16 }, "status" => "inactive"
      )
      expect(policy.reload.name).to eq("Password Strict")
    end

    it "accepts keeping the record's own existing name (S10)" do
      policy = create(:policy, organization: organization, name: "Password Baseline")

      patch_policy(policy.id, { name: "Password Baseline", type: "password_v2", configuration: {} })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.type).to eq("password_v2")
    end

    it "leaves other fields untouched when only one field is sent (PATCH is partial)" do
      policy = create(:policy, organization: organization, name: "Password Baseline", type: "password",
                                configuration: { "min_length" => 8 }, status: :active)

      patch_policy(policy.id, { name: "Renamed" })

      expect(response).to have_http_status(:ok)
      policy.reload
      expect(policy.name).to eq("Renamed")
      expect(policy.type).to eq("password")
      expect(policy.configuration).to eq({ "min_length" => 8 })
      expect(policy.active?).to be(true)
    end

    it "allows changing type to any free-form value, even one already used by another policy (S15)" do
      create(:policy, organization: organization, type: "wifi")
      policy = create(:policy, organization: organization, type: "password")

      patch_policy(policy.id, { type: "wifi" })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.type).to eq("wifi")
    end

    it "toggles status from active to inactive without any warning/blocker (S16)" do
      policy = create(:policy, organization: organization, status: :active)

      patch_policy(policy.id, { status: "inactive" })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.inactive?).to be(true)
    end

    it "toggles status from inactive to active (S17)" do
      policy = create(:policy, organization: organization, status: :inactive)

      patch_policy(policy.id, { status: "active" })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.active?).to be(true)
    end

    it "trims the new name before storing it" do
      policy = create(:policy, organization: organization)

      patch_policy(policy.id, { name: "  Password Strict  " })

      expect(body["policy"]["name"]).to eq("Password Strict")
    end
  end

  describe "the configuration strong-params trap (docs/design/F7-api.md §2.4)" do
    it "leaves configuration untouched when the key is absent from the request" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { name: "Renamed" })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.configuration).to eq({ "min_length" => 8 })
    end

    it "returns 422, not a silent 200, when configuration is explicitly null" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: nil })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
      expect(policy.reload.configuration).to eq({ "min_length" => 8 })
    end

    it "returns 422, not a silent 200, when configuration is a plain string" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: "not an object" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
      expect(policy.reload.configuration).to eq({ "min_length" => 8 })
    end

    it "returns 422, not a silent 200, when configuration is an array" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: [ 1, 2, 3 ] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
      expect(policy.reload.configuration).to eq({ "min_length" => 8 })
    end

    it "returns 422, not a silent 200, when configuration is a number" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: 5 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("configuration" => [ Policy::CONFIGURATION_INVALID_MESSAGE ])
    end

    it "accepts an explicit empty object, replacing the previous configuration" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: {} })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.configuration).to eq({})
    end

    it "replaces configuration with the new object sent" do
      policy = create(:policy, organization: organization, configuration: { "min_length" => 8 })

      patch_policy(policy.id, { configuration: { "min_length" => 16, "require_symbol" => true } })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.configuration).to eq({ "min_length" => 16, "require_symbol" => true })
    end
  end

  describe "status enum guard on update (docs/design/F7-api.md §2.3)" do
    it "rejects a status outside the enum with 422, not 500, and changes nothing" do
      policy = create(:policy, organization: organization, status: :active)

      patch_policy(policy.id, { status: "archived" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
      expect(policy.reload.active?).to be(true)
    end
  end

  describe "validation" do
    it "rejects renaming to a name another policy in the org already uses (A9)" do
      create(:policy, organization: organization, name: "VPN Config")
      policy = create(:policy, organization: organization, name: "Password Baseline")

      patch_policy(policy.id, { name: "VPN Config" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_TAKEN_MESSAGE ])
      expect(policy.reload.name).to eq("Password Baseline")
    end

    it "allows renaming to a name only used in ANOTHER organization" do
      create(:policy, organization: other_organization, name: "VPN Config")
      policy = create(:policy, organization: organization, name: "Password Baseline")

      patch_policy(policy.id, { name: "VPN Config" })

      expect(response).to have_http_status(:ok)
    end

    it "rejects a blank name" do
      policy = create(:policy, organization: organization, name: "Password Baseline")

      patch_policy(policy.id, { name: "   " })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_BLANK_MESSAGE ])
      expect(policy.reload.name).to eq("Password Baseline")
    end

    it "rejects a blank type" do
      policy = create(:policy, organization: organization, type: "password")

      patch_policy(policy.id, { type: "   " })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("type" => [ Policy::TYPE_BLANK_MESSAGE ])
      expect(policy.reload.type).to eq("password")
    end

    it "rejects a name longer than 100 characters" do
      policy = create(:policy, organization: organization)

      patch_policy(policy.id, { name: "a" * 101 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("name")
    end

    it "ignores an organization_id in the body" do
      policy = create(:policy, organization: organization)

      patch_policy(policy.id, { name: "Renamed", organization_id: other_organization.id })

      expect(response).to have_http_status(:ok)
      expect(policy.reload.organization).to eq(organization)
      expect(other_organization.policies.count).to eq(0)
    end

    # Same race-condition rescue path as create, exercised via update.
    it "turns a DB-level unique-index violation on rename into the same 422, not a 500" do
      create(:policy, organization: organization, name: "VPN Config")
      policy = create(:policy, organization: organization, name: "Password Baseline")
      allow_any_instance_of(Policy).to receive(:valid?).and_return(true)

      patch_policy(policy.id, { name: "VPN Config" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Policy::NAME_TAKEN_MESSAGE ])
    end
  end

  describe "404s, never 403 (S3, CLAUDE.md §4)" do
    it "returns 404 for a policy belonging to another organization, and changes nothing" do
      policy = create(:policy, organization: other_organization, name: "Theirs")

      patch_policy(policy.id, { name: "Hijacked" })

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
      expect(policy.reload.name).to eq("Theirs")
    end

    it "returns 404 for an id that does not exist" do
      patch_policy(999_999_999, { name: "Password Strict" })

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed id" do
      patch_policy("abc", { name: "Password Strict" })

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end
  end
end

RSpec.describe "routing for /api/v1/policies", type: :routing do
  it "routes the three endpoints F7 owns" do
    expect(get: "/api/v1/policies").to be_routable
    expect(post: "/api/v1/policies").to be_routable
    expect(patch: "/api/v1/policies/1").to be_routable
  end

  # SoT OQ-2/OQ-7 — deliberately no show/destroy route in F7.
  it "does not route GET /api/v1/policies/:id to any controller action" do
    expect(get: "/api/v1/policies/1").not_to be_routable
  end

  it "does not route DELETE /api/v1/policies/:id to any controller action" do
    expect(delete: "/api/v1/policies/1").not_to be_routable
  end
end
