require "rails_helper"

RSpec.describe "GET /api/v1/groups", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_groups(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/groups", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  # Counts the SELECT/INSERT/... statements one block issues, ignoring the
  # transaction bookkeeping RSpec's transactional fixtures add. Used to pin
  # the "one grouped count per page" promise (plan F6 "Bẫy #5"), which no
  # behavioural assertion can catch.
  def count_queries(&block)
    count = 0
    counter = ->(_name, _start, _finish, _id, payload) { count += 1 unless payload[:name].in?([ "SCHEMA", "TRANSACTION" ]) }
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record", &block)
    count
  end

  describe "authentication (A20)" do
    it "rejects a request with no Authorization header" do
      get_groups({}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_groups({}, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects a token belonging to a user who has been deactivated" do
      token = token_for(user)
      user.update!(status: :inactive)

      get_groups({}, token: token)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "the default listing" do
    it "returns the first page of the organization's groups with pagination metadata (S2)" do
      create_list(:group, 25, organization: organization)

      get_groups

      expect(response).to have_http_status(:ok)
      expect(body["groups"].size).to eq(20)
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 25, "total_pages" => 2
      )
    end

    # Five fields at F5, six from F6 on: devices_count joined the shape once
    # group_memberships existed to count (F5 OQ-4 handed the decision to F6,
    # docs/design/F6-api.md §1).
    it "serializes exactly the six fields the list screen needs" do
      group = create(:group, organization: organization, name: "Sales Team", description: "Đội kinh doanh")

      get_groups

      expect(body["groups"].first.keys).to contain_exactly(
        "id", "name", "description", "devices_count", "created_at", "updated_at"
      )
      expect(body["groups"].first).to include(
        "id" => group.id, "name" => "Sales Team", "description" => "Đội kinh doanh"
      )
    end

    it "never exposes organization_id" do
      create(:group, organization: organization)

      get_groups

      expect(body["groups"].first).not_to have_key("organization_id")
    end

    it "returns null, never an empty string, for a group with no description (A25)" do
      create(:group, :without_description, organization: organization)

      get_groups

      expect(body["groups"].first["description"]).to be_nil
    end

    it "sorts by created_at DESC then id DESC, so the newest group is first (S9)" do
      older = create(:group, organization: organization, name: "Older", created_at: 2.days.ago)
      newest = create(:group, organization: organization, name: "Newest", created_at: 1.hour.ago)

      get_groups

      expect(body["groups"].map { |g| g["id"] }).to eq([ newest.id, older.id ])
    end

    it "breaks a created_at tie by id DESC, so the order is deterministic" do
      same_time = 1.hour.ago
      first = create(:group, organization: organization, created_at: same_time)
      second = create(:group, organization: organization, created_at: same_time)

      get_groups

      expect(body["groups"].map { |g| g["id"] }).to eq([ second.id, first.id ])
    end

    it "returns an empty list with zeroed meta for an organization with no groups (A14)" do
      create_list(:group, 3, organization: other_organization)

      get_groups

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 0, "total_pages" => 0
      )
    end
  end

  describe "organization isolation (S1/S28, CLAUDE.md §4)" do
    it "never returns another organization's groups" do
      mine = create(:group, organization: organization, name: "Mine")
      create(:group, organization: other_organization, name: "Theirs")

      get_groups

      expect(body["groups"].map { |g| g["name"] }).to eq([ "Mine" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "lets two organizations reuse the same group name without collision (A6)" do
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: other_organization, name: "Sales Team")
      other_user = create(:user, organization: other_organization)

      get_groups
      expect(body["meta"]["total_count"]).to eq(1)

      get_groups({}, token: token_for(other_user))
      expect(body["meta"]["total_count"]).to eq(1)
    end
  end

  describe "pagination" do
    it "returns the requested page" do
      create_list(:group, 25, organization: organization)

      get_groups({ page: 2 })

      expect(body["groups"].size).to eq(5)
      expect(body["meta"]["current_page"]).to eq(2)
    end

    it "returns 200 with an empty list for a page past the end (S3/A16)" do
      create_list(:group, 3, organization: organization)

      get_groups({ page: 99 })

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 99, "per_page" => 20, "total_count" => 3, "total_pages" => 1
      )
    end

    it "rejects a non-integer page and a non-positive per_page together in one response (S4/A17)" do
      get_groups({ page: "abc", per_page: 0 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "page" => [ "must be a positive integer" ],
        "per_page" => [ "must be a positive integer" ]
      )
    end

    it "rejects invalid pagination before it ever queries the database (A17)" do
      create(:group, organization: organization)

      expect_any_instance_of(GroupPolicy::Scope).not_to receive(:resolve)

      get_groups({ page: "0" })

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "clamps per_page to the maximum instead of erroring, and reports the clamped value (A18)" do
      create_list(:group, 3, organization: organization)

      get_groups({ per_page: 999 })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]["per_page"]).to eq(100)
    end

    it "treats absent pagination params as the defaults, not as errors" do
      get_groups

      expect(response).to have_http_status(:ok)
      expect(body["meta"]).to include("current_page" => 1, "per_page" => 20)
    end
  end

  describe "search by name (S6, OQ-6)" do
    it "matches a partial name, case-insensitively" do
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "Engineering")

      get_groups({ q: "sAlEs" })

      expect(body["groups"].map { |g| g["name"] }).to eq([ "Sales Team" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "returns both case variants that coexist in one org (F5-db.md §4c — not a bug)" do
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "sales team")

      get_groups({ q: "sales" })

      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "returns an empty list with a zeroed total when nothing matches (A15)" do
      create(:group, organization: organization, name: "Sales Team")

      get_groups({ q: "zzzz" })

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
      expect(body["meta"]["total_pages"]).to eq(0)
    end

    it "treats a blank q as no filter at all" do
      create_list(:group, 2, organization: organization)

      get_groups({ q: "" })

      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "treats a whitespace-only q as no filter, not as an error" do
      create_list(:group, 2, organization: organization)

      get_groups({ q: "   " })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "trims q before matching" do
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "Engineering")

      get_groups({ q: "  sales  " })

      expect(body["groups"].map { |g| g["name"] }).to eq([ "Sales Team" ])
    end

    it "never leaks another organization's groups through the search" do
      create(:group, organization: other_organization, name: "Sales Team")

      get_groups({ q: "sales" })

      expect(body["groups"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
    end

    # The next three guard docs/plan/F5-group-crud.md "Bẫy #3": without
    # Group.sanitize_sql_like, the user's % and _ become LIKE wildcards and
    # the search silently returns rows it should not.
    it "treats % typed by the user as a literal percent sign, not a wildcard" do
      create(:group, organization: organization, name: "100% Coverage")
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "Support_Desk")

      get_groups({ q: "100%" })

      expect(body["groups"].map { |g| g["name"] }).to eq([ "100% Coverage" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "does not turn a lone % into 'match everything'" do
      create(:group, organization: organization, name: "100% Coverage")
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "Support_Desk")

      get_groups({ q: "%" })

      expect(body["groups"].map { |g| g["name"] }).to eq([ "100% Coverage" ])
    end

    it "treats _ typed by the user as a literal underscore, not a single-char wildcard" do
      create(:group, organization: organization, name: "100% Coverage")
      create(:group, organization: organization, name: "Sales Team")
      create(:group, organization: organization, name: "Support_Desk")

      get_groups({ q: "_" })

      expect(body["groups"].map { |g| g["name"] }).to eq([ "Support_Desk" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    # Guards the placeholder: interpolating q straight into the SQL string
    # would make this a real injection, not just a behaviour bug.
    it "treats a SQL-injection attempt as an ordinary search string" do
      create_list(:group, 3, organization: organization)

      get_groups({ q: "' OR 1=1 --" })

      expect(response).to have_http_status(:ok)
      expect(body["groups"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
      expect(Group.count).to eq(3)
    end

    it "combines search with pagination on the filtered set" do
      create_list(:group, 25, organization: organization, description: "x")
      create(:group, organization: organization, name: "Sales Team")

      get_groups({ q: "sales", page: 1 })

      expect(body["groups"].size).to eq(1)
      expect(body["meta"]["total_count"]).to eq(1)
      expect(body["meta"]["total_pages"]).to eq(1)
    end
  end

  describe "devices_count (F6)" do
    it "reports how many devices are members of each group" do
      create(:group, organization: organization, name: "Field Ops", created_at: 2.days.ago)
      populated = create(:group, organization: organization, name: "Sales Team", created_at: 1.day.ago)
      create_list(:device, 3, organization: organization).each do |device|
        create(:group_membership, group: populated, device: device)
      end

      get_groups

      counts = body["groups"].to_h { |group| [ group["name"], group["devices_count"] ] }
      expect(counts).to eq("Sales Team" => 3, "Field Ops" => 0)
    end

    it "counts zero for a group nobody has joined, rather than omitting the field" do
      create(:group, organization: organization)

      get_groups

      expect(body["groups"].first["devices_count"]).to eq(0)
    end

    it "never counts a membership that belongs to a different group" do
      mine = create(:group, organization: organization, created_at: 1.day.ago)
      theirs = create(:group, organization: organization)
      create(:group_membership, group: theirs, device: create(:device, organization: organization))

      get_groups

      counts = body["groups"].to_h { |group| [ group["id"], group["devices_count"] ] }
      expect(counts).to eq(theirs.id => 1, mine.id => 0)
    end

    # plan F6 "Bẫy #5": the obvious implementation (`group.devices.count`
    # inside the map) is an N+1 that nothing else in this file would catch —
    # every assertion above passes either way. Pin the query count instead.
    it "uses ONE grouped count for the whole page, not one query per group" do
      create_list(:group, 5, organization: organization).each do |group|
        create(:group_membership, group: group, device: create(:device, organization: organization))
      end

      # One warm-up request first: the very first request of an example pays a
      # few one-off queries (connection/schema bookkeeping) that would
      # otherwise be counted against the 5-group run only.
      get_groups
      five_group_queries = count_queries { get_groups }

      create_list(:group, 5, organization: organization).each do |group|
        create(:group_membership, group: group, device: create(:device, organization: organization))
      end

      ten_group_queries = count_queries { get_groups }

      expect(body["groups"].size).to eq(10)
      expect(ten_group_queries).to eq(five_group_queries)
    end
  end
end

RSpec.describe "GET /api/v1/groups/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_group(id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/groups/#{id}", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A30)" do
    it "rejects a request with no Authorization header" do
      group = create(:group, organization: organization)

      get_group(group.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      group = create(:group, organization: organization)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_group(group.id, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "viewing successfully" do
    it "returns exactly the six serialized fields" do
      group = create(:group, organization: organization, name: "Sales Team", description: "Đội kinh doanh")

      get_group(group.id)

      expect(response).to have_http_status(:ok)
      expect(body["group"].keys).to contain_exactly(
        "id", "name", "description", "devices_count", "created_at", "updated_at"
      )
      expect(body["group"]).to include(
        "id" => group.id, "name" => "Sales Team", "description" => "Đội kinh doanh", "devices_count" => 0
      )
    end

    it "reports the real member count" do
      group = create(:group, organization: organization)
      create_list(:device, 4, organization: organization).each do |device|
        create(:group_membership, group: group, device: device)
      end

      get_group(group.id)

      expect(body["group"]["devices_count"]).to eq(4)
    end

    it "returns null, never an empty string, for a group with no description" do
      group = create(:group, :without_description, organization: organization)

      get_group(group.id)

      expect(body["group"]["description"]).to be_nil
    end

    it "never serializes organization_id" do
      group = create(:group, organization: organization)

      get_group(group.id)

      expect(body["group"]).not_to have_key("organization_id")
    end
  end

  describe "404s, never 403 (CLAUDE.md §4, A1/A5)" do
    it "returns 404 for a group belonging to another organization" do
      foreign = create(:group, organization: other_organization)

      get_group(foreign.id)

      expect(response).to have_http_status(:not_found)
      expect(body).to eq("error" => "Not found")
    end

    it "does not leak the foreign group's member count through the 404 body" do
      foreign = create(:group, organization: other_organization)
      create(:group_membership, group: foreign, device: create(:device, organization: other_organization))

      get_group(foreign.id)

      expect(response.body).not_to include("devices_count")
    end

    it "returns 404 for an id that does not exist" do
      get_group(999_999)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed id" do
      get_group("abc")

      expect(response).to have_http_status(:not_found)
    end
  end
end

RSpec.describe "POST /api/v1/groups", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def post_group(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/groups", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A20)" do
    it "rejects a request with no Authorization header" do
      post_group({ name: "Sales Team" }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(Group.count).to eq(0)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      post_group({ name: "Sales Team" }, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(Group.count).to eq(0)
    end
  end

  describe "creating successfully (S8)" do
    it "returns 201 with exactly the six serialized fields" do
      post_group({ name: "Sales Team", description: "Đội kinh doanh" })

      expect(response).to have_http_status(:created)
      expect(body["group"].keys).to contain_exactly(
        "id", "name", "description", "devices_count", "created_at", "updated_at"
      )
      expect(body["group"]).to include("name" => "Sales Team", "description" => "Đội kinh doanh")
    end

    it "reports devices_count 0 for a brand-new group" do
      post_group({ name: "Sales Team" })

      expect(body["group"]["devices_count"]).to eq(0)
    end

    it "persists the group in the caller's own organization" do
      post_group({ name: "Sales Team" })

      expect(organization.groups.count).to eq(1)
      expect(Group.find(body["group"]["id"]).organization).to eq(organization)
    end

    it "accepts a flat body, with no `group:` wrapper" do
      post_group({ name: "Sales Team" })

      expect(response).to have_http_status(:created)
    end

    it "trims the name before storing it" do
      post_group({ name: "  Sales Team  " })

      expect(body["group"]["name"]).to eq("Sales Team")
    end

    it "stores a missing description as null (S10/A25)" do
      post_group({ name: "Sales Team" })

      expect(response).to have_http_status(:created)
      expect(body["group"]["description"]).to be_nil
    end

    it "stores an empty-string description as null, never as '' (A25)" do
      post_group({ name: "Sales Team", description: "" })

      expect(response).to have_http_status(:created)
      expect(body["group"]["description"]).to be_nil
    end

    it "stores a whitespace-only description as null" do
      post_group({ name: "Sales Team", description: "   " })

      expect(body["group"]["description"]).to be_nil
    end

    it "accepts a name of exactly 100 and a description of exactly 500 characters" do
      post_group({ name: "a" * 100, description: "b" * 500 })

      expect(response).to have_http_status(:created)
    end
  end

  describe "validation" do
    it "rejects a blank name on the name field (S11/A4)" do
      post_group({ name: "" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_BLANK_MESSAGE ])
      expect(Group.count).to eq(0)
    end

    it "rejects a whitespace-only name on the name field (S11/A4)" do
      post_group({ name: "   " })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_BLANK_MESSAGE ])
      expect(Group.count).to eq(0)
    end

    it "rejects a missing name without raising (A4)" do
      post_group({ description: "orphan" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("name")
    end

    it "rejects a duplicate name inside the same organization (S12/A5)" do
      create(:group, organization: organization, name: "Sales Team")

      post_group({ name: "Sales Team" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_TAKEN_MESSAGE ])
      expect(organization.groups.count).to eq(1)
    end

    it "allows the same name as a group in ANOTHER organization (S13/A6)" do
      create(:group, organization: other_organization, name: "Sales Team")

      post_group({ name: "Sales Team" })

      expect(response).to have_http_status(:created)
    end

    it "rejects a name longer than 100 characters (S15/A10)" do
      post_group({ name: "a" * 101 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("name")
    end

    it "rejects a description longer than 500 characters (S15/A10)" do
      post_group({ name: "Sales Team", description: "b" * 501 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("description")
    end

    it "reports every failing field in one response" do
      post_group({ name: "", description: "b" * 501 })

      expect(body["errors"].keys).to contain_exactly("name", "description")
    end

    # A7: the loser of a create race never sees its own uniqueness check
    # fail — it hits the composite unique index instead. The client must not
    # be able to tell that apart from A5 above.
    it "turns a DB-level unique-index violation into the same 422, not a 500" do
      create(:group, organization: organization, name: "Sales Team")
      # Simulate losing the race: the app-level uniqueness check passes (the
      # competing row was not visible yet) and the INSERT hits the index.
      allow_any_instance_of(Group).to receive(:valid?).and_return(true)

      post_group({ name: "Sales Team" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_TAKEN_MESSAGE ])
    end
  end

  describe "organization_id cannot be overridden (S33/A22)" do
    it "ignores an organization_id in the body and uses the token's organization" do
      post_group({ name: "Sales Team", organization_id: other_organization.id })

      expect(response).to have_http_status(:created)
      expect(Group.find(body["group"]["id"]).organization).to eq(organization)
      expect(other_organization.groups.count).to eq(0)
    end

    it "never serializes organization_id back to the client" do
      post_group({ name: "Sales Team" })

      expect(body["group"]).not_to have_key("organization_id")
    end
  end
end

RSpec.describe "PATCH /api/v1/groups/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def patch_group(id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    patch "/api/v1/groups/#{id}", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A20)" do
    it "rejects a request with no Authorization header" do
      group = create(:group, organization: organization, name: "Sales Team")

      patch_group(group.id, { name: "Renamed" }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(group.reload.name).to eq("Sales Team")
    end

    it "rejects an expired token" do
      group = create(:group, organization: organization, name: "Sales Team")
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      patch_group(group.id, { name: "Renamed" }, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(group.reload.name).to eq("Sales Team")
    end
  end

  describe "updating successfully (S16)" do
    it "updates name and description together and returns 200" do
      group = create(:group, organization: organization, name: "Sales Team", description: "old")

      patch_group(group.id, { name: "Sales EMEA", description: "new" })

      expect(response).to have_http_status(:ok)
      expect(body["group"]).to include("name" => "Sales EMEA", "description" => "new")
      expect(group.reload.name).to eq("Sales EMEA")
    end

    it "accepts keeping the record's own existing name (S17/A8)" do
      group = create(:group, organization: organization, name: "Sales Team")

      patch_group(group.id, { name: "Sales Team", description: "just the description" })

      expect(response).to have_http_status(:ok)
      expect(group.reload.description).to eq("just the description")
    end

    it "leaves name untouched when only description is sent (PATCH is partial)" do
      group = create(:group, organization: organization, name: "Sales Team", description: "old")

      patch_group(group.id, { description: "new" })

      expect(response).to have_http_status(:ok)
      expect(group.reload.name).to eq("Sales Team")
      expect(group.description).to eq("new")
    end

    it "clears the description when an empty string is sent, storing null" do
      group = create(:group, organization: organization, description: "old")

      patch_group(group.id, { description: "" })

      expect(response).to have_http_status(:ok)
      expect(body["group"]["description"]).to be_nil
      expect(group.reload.description).to be_nil
    end

    it "trims the new name before storing it" do
      group = create(:group, organization: organization)

      patch_group(group.id, { name: "  Sales EMEA  " })

      expect(body["group"]["name"]).to eq("Sales EMEA")
    end

    it "recomputes devices_count on update instead of dropping the field" do
      group = create(:group, organization: organization)
      create_list(:device, 2, organization: organization).each do |device|
        create(:group_membership, group: group, device: device)
      end

      patch_group(group.id, { name: "Sales EMEA" })

      expect(body["group"]["devices_count"]).to eq(2)
    end

    it "returns the six serialized fields, with no organization_id" do
      group = create(:group, organization: organization)

      patch_group(group.id, { name: "Sales EMEA" })

      expect(body["group"].keys).to contain_exactly(
        "id", "name", "description", "devices_count", "created_at", "updated_at"
      )
    end
  end

  describe "validation" do
    it "rejects renaming to a name another group in the org already uses (S18/A9)" do
      create(:group, organization: organization, name: "Engineering")
      group = create(:group, organization: organization, name: "Sales Team")

      patch_group(group.id, { name: "Engineering" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_TAKEN_MESSAGE ])
      expect(group.reload.name).to eq("Sales Team")
    end

    it "allows renaming to a name only used in ANOTHER organization (A6)" do
      create(:group, organization: other_organization, name: "Engineering")
      group = create(:group, organization: organization, name: "Sales Team")

      patch_group(group.id, { name: "Engineering" })

      expect(response).to have_http_status(:ok)
    end

    it "rejects a blank name (A4)" do
      group = create(:group, organization: organization, name: "Sales Team")

      patch_group(group.id, { name: "   " })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("name" => [ Group::NAME_BLANK_MESSAGE ])
      expect(group.reload.name).to eq("Sales Team")
    end

    it "rejects a name longer than 100 characters (A10)" do
      group = create(:group, organization: organization)

      patch_group(group.id, { name: "a" * 101 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("name")
    end

    it "rejects a description longer than 500 characters (A10)" do
      group = create(:group, organization: organization)

      patch_group(group.id, { description: "b" * 501 })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("description")
    end

    it "ignores an organization_id in the body (A22)" do
      group = create(:group, organization: organization)

      patch_group(group.id, { name: "Sales EMEA", organization_id: other_organization.id })

      expect(response).to have_http_status(:ok)
      expect(group.reload.organization).to eq(organization)
      expect(other_organization.groups.count).to eq(0)
    end
  end

  describe "404s, never 403 (CLAUDE.md §4)" do
    it "returns 404 for a group belonging to another organization, and changes nothing (S29/A1)" do
      group = create(:group, organization: other_organization, name: "Theirs")

      patch_group(group.id, { name: "Hijacked" })

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
      expect(group.reload.name).to eq("Theirs")
    end

    it "returns 404 for an id that does not exist (S31/A2)" do
      patch_group(999_999_999, { name: "Sales EMEA" })

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed id (S32/A3)" do
      patch_group("abc", { name: "Sales EMEA" })

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end

    it "returns 404 for a group that has already been deleted (A12)" do
      group = create(:group, organization: organization)
      id = group.id
      group.destroy!

      patch_group(id, { name: "Sales EMEA" })

      expect(response).to have_http_status(:not_found)
    end
  end
end

RSpec.describe "DELETE /api/v1/groups/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def delete_group(id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    delete "/api/v1/groups/#{id}", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A20)" do
    it "rejects a request with no Authorization header and deletes nothing" do
      group = create(:group, organization: organization)

      delete_group(group.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(Group.exists?(group.id)).to be(true)
    end

    it "rejects an expired token and deletes nothing" do
      group = create(:group, organization: organization)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      delete_group(group.id, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(Group.exists?(group.id)).to be(true)
    end
  end

  describe "deleting successfully (S21)" do
    it "returns 204 with an empty body" do
      group = create(:group, organization: organization)

      delete_group(group.id)

      expect(response).to have_http_status(:no_content)
      expect(response.body).to be_empty
    end

    it "removes exactly one group" do
      create_list(:group, 2, organization: organization)
      group = create(:group, organization: organization)

      expect { delete_group(group.id) }.to change(Group, :count).by(-1)
      expect(Group.exists?(group.id)).to be(false)
    end

    it "makes the group disappear from the list afterwards (S22)" do
      group = create(:group, organization: organization, name: "Sales Team")

      delete_group(group.id)
      get "/api/v1/groups", headers: { "Authorization" => "Bearer #{token_for(user)}" }

      expect(body["groups"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
    end

    it "makes a follow-up PATCH on the same id return 404 (S22)" do
      group = create(:group, organization: organization)

      delete_group(group.id)
      patch "/api/v1/groups/#{group.id}", params: { name: "Zombie" },
                                          headers: { "Authorization" => "Bearer #{token_for(user)}" }

      expect(response).to have_http_status(:not_found)
    end

    # docs/plan/F5-group-crud.md "Bẫy #1": #delete would pass every test here
    # today and silently orphan join rows from F6/F8 onwards. Pin the call so
    # nobody "optimizes" it away.
    # A20/A21 at the request level — the model spec proves dependent:
    # :delete_all works, this proves the endpoint actually reaches it.
    it "removes every group_membership of the group, and no device (A20)" do
      group = create(:group, organization: organization)
      devices = create_list(:device, 3, organization: organization)
      devices.each { |device| create(:group_membership, group: group, device: device) }

      delete_group(group.id)

      expect(response).to have_http_status(:no_content)
      expect(GroupMembership.where(group_id: group.id)).to be_empty
      expect(Device.where(id: devices.map(&:id)).count).to eq(3)
    end

    it "leaves the memberships of other groups alone" do
      doomed = create(:group, organization: organization)
      survivor = create(:group, organization: organization)
      device = create(:device, organization: organization)
      create(:group_membership, group: doomed, device: device)
      create(:group_membership, group: survivor, device: device)

      delete_group(doomed.id)

      expect(GroupMembership.pluck(:group_id)).to eq([ survivor.id ])
    end

    it "goes through #destroy, so future dependent: associations are honoured" do
      group = create(:group, organization: organization)

      expect_any_instance_of(Group).to receive(:destroy!).and_call_original

      delete_group(group.id)
    end
  end

  describe "repeat deletes (A12/A24)" do
    it "returns 404 on the second DELETE of the same id" do
      group = create(:group, organization: organization)

      delete_group(group.id)
      expect(response).to have_http_status(:no_content)

      delete_group(group.id)
      expect(response).to have_http_status(:not_found)
    end
  end

  describe "404s, never 403 (CLAUDE.md §4)" do
    it "returns 404 for a group of another organization AND deletes nothing (S30/A1)" do
      group = create(:group, organization: other_organization)

      expect { delete_group(group.id) }.not_to change(Group, :count)

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
      expect(Group.exists?(group.id)).to be(true)
    end

    it "returns 404 for an id that does not exist (S31/A2)" do
      delete_group(999_999_999)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed id (S32/A3)" do
      create(:group, organization: organization)

      expect { delete_group("abc") }.not_to change(Group, :count)

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end
  end
end

RSpec.describe "routing for /api/v1/groups", type: :routing do
  it "routes the four endpoints F5 owns" do
    expect(get: "/api/v1/groups").to be_routable
    expect(post: "/api/v1/groups").to be_routable
    expect(patch: "/api/v1/groups/1").to be_routable
    expect(delete: "/api/v1/groups/1").to be_routable
  end

  # F5 asserted this route did NOT exist (SoT F5 OQ-5 — the edit form
  # prefilled from the list, so a detail endpoint was dead weight). F6's Group
  # Detail screen makes it real.
  it "routes GET /api/v1/groups/:id to the detail action (F6)" do
    expect(get: "/api/v1/groups/1").to route_to(controller: "api/v1/groups", action: "show", id: "1")
  end

  # `member do ... end`, so the Group param stays :id and the device param is
  # its own segment (docs/design/F6-api.md §1).
  it "routes the three membership endpoints F6 owns" do
    expect(get: "/api/v1/groups/1/devices").to route_to(controller: "api/v1/group_devices", action: "index", id: "1")
    expect(post: "/api/v1/groups/1/devices").to route_to(controller: "api/v1/group_devices", action: "create", id: "1")
    expect(delete: "/api/v1/groups/1/devices/2").to route_to(controller: "api/v1/group_devices", action: "destroy", id: "1", device_id: "2")
  end
end
