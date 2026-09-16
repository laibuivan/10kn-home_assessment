require "rails_helper"

RSpec.describe "GET /api/v1/devices", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_devices(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/devices", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  def post_device(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/devices", params: params, headers: headers
  end

  def patch_device(id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    patch "/api/v1/devices/#{id}", params: params, headers: headers
  end

  describe "authentication (A10)" do
    it "rejects a request with no Authorization header" do
      get_devices({}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_devices({}, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects a token belonging to a user who has been deactivated" do
      token = token_for(user)
      user.update!(status: :inactive)

      get_devices({}, token: token)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "the default listing" do
    it "returns the first page of the organization's devices with pagination metadata" do
      create_list(:device, 25, organization: organization)

      get_devices

      expect(response).to have_http_status(:ok)
      expect(body["devices"].size).to eq(20)
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 25, "total_pages" => 2
      )
    end

    it "serializes exactly the fields the list screen needs" do
      device = create(:device, organization: organization, identifier: "DEV-0001", name: "Laptop",
                               platform: :macos, os_version: "14.4", status: :inactive)

      get_devices

      expect(body["devices"].first).to include(
        "id" => device.id,
        "identifier" => "DEV-0001",
        "name" => "Laptop",
        "platform" => "macos",
        "os_version" => "14.4",
        "status" => "inactive"
      )
      expect(body["devices"].first.keys).to match_array(
        %w[id identifier name platform os_version status last_seen_at created_at updated_at]
      )
    end

    it "serializes a device that has never checked in with null os_version/last_seen_at" do
      create(:device, :never_seen, organization: organization)

      get_devices

      expect(body["devices"].first["os_version"]).to be_nil
      expect(body["devices"].first["last_seen_at"]).to be_nil
    end

    it "orders newest first, tie-broken by id descending (SoT §12 OQ-2)" do
      same_time = 1.day.ago
      older = create(:device, organization: organization, created_at: 2.days.ago)
      first_of_tie = create(:device, organization: organization, created_at: same_time)
      second_of_tie = create(:device, organization: organization, created_at: same_time)

      get_devices

      expect(body["devices"].map { |d| d["id"] }).to eq([ second_of_tie.id, first_of_tie.id, older.id ])
    end

    it "returns an empty list and zeroed metadata when the organization has no devices (A1)" do
      get_devices

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 0, "total_pages" => 0
      )
    end
  end

  describe "filtering" do
    before do
      create_list(:device, 3, :ios, organization: organization, status: :active)
      create_list(:device, 2, :android, organization: organization, status: :active)
      create(:device, :android, organization: organization, status: :retired)
      create(:device, :macos, organization: organization, status: :inactive)
    end

    it "filters by platform" do
      get_devices({ platform: "ios" })

      expect(body["devices"].map { |d| d["platform"] }).to all(eq("ios"))
      expect(body["meta"]["total_count"]).to eq(3)
    end

    it "filters by status" do
      get_devices({ status: "retired" })

      expect(body["devices"].map { |d| d["status"] }).to all(eq("retired"))
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "combines platform and status as AND, never OR (A3)" do
      get_devices({ platform: "android", status: "active" })

      expect(body["meta"]["total_count"]).to eq(2)
      expect(body["devices"]).to all(include("platform" => "android", "status" => "active"))
    end

    it "treats a blank filter as 'all'" do
      get_devices({ platform: "", status: "" })

      expect(body["meta"]["total_count"]).to eq(7)
    end

    it "returns an empty list (not an error) when a valid filter matches nothing (A2)" do
      get_devices({ platform: "macos", status: "retired" })

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
      expect(body["meta"]["total_pages"]).to eq(0)
    end

    it "rejects a platform outside the enum with a field-level 422 (A4)" do
      get_devices({ platform: "windows" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("platform" => [ "is not included in the list" ])
    end

    it "rejects a status outside the enum with a field-level 422 (A4)" do
      get_devices({ status: "deleted" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
    end

    it "reports both bad enum filters at once, not just the first" do
      get_devices({ platform: "windows", status: "deleted" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].keys).to match_array(%w[platform status])
    end
  end

  describe "pagination" do
    it "returns the requested page" do
      create_list(:device, 25, organization: organization)

      get_devices({ page: 2 })

      expect(body["devices"].size).to eq(5)
      expect(body["meta"]["current_page"]).to eq(2)
    end

    it "returns the remainder on a partial last page (A5)" do
      create_list(:device, 47, organization: organization)

      get_devices({ page: 3 })

      expect(body["devices"].size).to eq(7)
      expect(body["meta"]["total_pages"]).to eq(3)
    end

    it "never repeats or skips a device across pages" do
      create_list(:device, 25, organization: organization)

      get_devices({ page: 1 })
      first_page_ids = body["devices"].map { |d| d["id"] }
      get_devices({ page: 2 })
      second_page_ids = body["devices"].map { |d| d["id"] }

      expect(first_page_ids & second_page_ids).to be_empty
      expect((first_page_ids + second_page_ids).uniq.size).to eq(25)
    end

    it "honours a valid per_page" do
      create_list(:device, 25, organization: organization)

      get_devices({ per_page: 5 })

      expect(body["devices"].size).to eq(5)
      expect(body["meta"]).to include("per_page" => 5, "total_pages" => 5)
    end

    it "returns 200 with an empty list when the page is past the end (A6)" do
      create_list(:device, 25, organization: organization)

      get_devices({ page: 999 })

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]).to include("total_count" => 25, "total_pages" => 2)
    end

    it "clamps an oversized per_page instead of erroring (A8)" do
      create_list(:device, 25, organization: organization)

      get_devices({ per_page: 100_000 })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]["per_page"]).to eq(100)
      expect(body["devices"].size).to eq(25)
    end

    it "does not return everything in one response when more rows exist than the cap" do
      create_list(:device, 101, organization: organization)

      get_devices({ per_page: 100_000 })

      expect(body["devices"].size).to eq(100)
      expect(body["meta"]["total_count"]).to eq(101)
    end

    %w[-1 0 abc 1.5 12abc].each do |bad_page|
      it "rejects page=#{bad_page.inspect} with a field-level 422 (A7)" do
        get_devices({ page: bad_page })

        expect(response).to have_http_status(:unprocessable_content)
        expect(body["errors"]).to eq("page" => [ "must be a positive integer" ])
      end
    end

    it "rejects a non-positive per_page the same way" do
      get_devices({ per_page: "0" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("per_page" => [ "must be a positive integer" ])
    end

    it "reports page and per_page together when both are invalid" do
      get_devices({ page: "abc", per_page: "-3" })

      expect(body["errors"].keys).to match_array(%w[page per_page])
    end

    it "checks pagination before the enum filters (a broken request shape wins)" do
      get_devices({ page: "abc", platform: "windows" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].keys).to eq(%w[page])
    end

    it "falls back to the defaults when the params are absent or blank" do
      create(:device, organization: organization)

      get_devices({ page: "", per_page: "" })

      expect(response).to have_http_status(:ok)
      expect(body["meta"]).to include("current_page" => 1, "per_page" => 20)
    end
  end

  describe "organization isolation (A9, CLAUDE.md §4)" do
    it "never returns another organization's devices" do
      mine = create(:device, organization: organization, identifier: "ACME-0001")
      create(:device, organization: other_organization, identifier: "GLBX-0001")

      get_devices

      expect(body["devices"].map { |d| d["identifier"] }).to eq([ mine.identifier ])
    end

    it "counts only the current organization's devices in the metadata" do
      create_list(:device, 3, organization: organization)
      create_list(:device, 9, organization: other_organization)

      get_devices

      expect(body["meta"]["total_count"]).to eq(3)
      expect(body["meta"]["total_pages"]).to eq(1)
    end

    it "keeps the boundary while filtering" do
      create(:device, :ios, organization: organization)
      create_list(:device, 4, :ios, organization: other_organization)

      get_devices({ platform: "ios" })

      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "shows nothing when only the other organization has devices, even paging through" do
      create_list(:device, 30, organization: other_organization)

      get_devices({ page: 1, per_page: 5 })

      expect(body["devices"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
    end

    it "lets two organizations reuse the same device identifier without collision" do
      create(:device, organization: organization, identifier: "SHARED-1")
      create(:device, organization: other_organization, identifier: "SHARED-1")
      other_user = create(:user, organization: other_organization)

      get_devices
      expect(body["meta"]["total_count"]).to eq(1)

      get_devices({}, token: token_for(other_user))
      expect(body["meta"]["total_count"]).to eq(1)
    end
  end
end

RSpec.describe "GET /api/v1/devices/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_device(id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/devices/#{id}", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication" do
    it "rejects a request with no Authorization header" do
      device = create(:device, organization: organization)

      get_device(device.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      device = create(:device, organization: organization)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_device(device.id, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "viewing successfully (A1 main flow)" do
    it "returns the device's full attributes, same shape as the list item" do
      device = create(:device, organization: organization, identifier: "IPHONE-001", name: "Alice's iPhone", platform: :ios, os_version: "17.4.1", status: :active)

      get_device(device.id)

      expect(response).to have_http_status(:ok)
      expect(body["device"]).to include(
        "id" => device.id,
        "identifier" => "IPHONE-001",
        "name" => "Alice's iPhone",
        "platform" => "ios",
        "os_version" => "17.4.1",
        "status" => "active"
      )
    end

    it "does not include any groups/applied_policies field (SoT F4 OQ-6)" do
      device = create(:device, organization: organization)

      get_device(device.id)

      expect(body["device"]).not_to have_key("groups")
      expect(body["device"]).not_to have_key("applied_policies")
    end
  end

  describe "cross-organization (SoT F4 A1, CLAUDE.md §4)" do
    it "returns 404, not 403, when the device belongs to another organization" do
      device = create(:device, organization: other_organization, identifier: "IPHONE-777")

      get_device(device.id)

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end
  end

  describe "nonexistent device (SoT F4 A2)" do
    it "returns 404 for an id that does not exist" do
      get_device(999_999_999)

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "malformed id (SoT F4 A3)" do
    it "returns 404, not a 500, for a non-integer id" do
      get_device("not-a-number")

      expect(response).to have_http_status(:not_found)
      expect(body["error"]).to eq("Not found")
    end
  end
end

RSpec.describe "POST /api/v1/devices", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def post_device(params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/devices", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A14)" do
    it "rejects a request with no Authorization header" do
      post_device({ identifier: "X", name: "X", platform: "ios" }, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "creating successfully (main flow, A2)" do
    it "creates the device belonging to the current organization" do
      post_device({ identifier: "IPHONE-001", name: "iPhone của Alice", platform: "ios" })

      expect(response).to have_http_status(:created)
      expect(body["device"]).to include(
        "identifier" => "IPHONE-001", "name" => "iPhone của Alice", "platform" => "ios"
      )
      expect(Device.find(body["device"]["id"]).organization_id).to eq(organization.id)
    end

    it "defaults status to active, ignoring any status the client sends (OQ-2)" do
      post_device({ identifier: "IPHONE-003", name: "Some Device", platform: "ios", status: "retired" })

      expect(response).to have_http_status(:created)
      expect(body["device"]["status"]).to eq("active")
    end

    it "ignores organization_id sent by the client (A9)" do
      post_device({ identifier: "IPHONE-104", name: "Spoofed Org Device", platform: "ios", organization_id: other_organization.id })

      expect(response).to have_http_status(:created)
      expect(Device.find(body["device"]["id"]).organization_id).to eq(organization.id)
    end
  end

  describe "duplicate identifier (A1, A3)" do
    it "rejects a duplicate identifier within the same organization with a field-level 422" do
      create(:device, organization: organization, identifier: "IPHONE-001")

      post_device({ identifier: "IPHONE-001", name: "Another Device", platform: "android" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("identifier" => [ Device::IDENTIFIER_TAKEN_MESSAGE ])
    end

    it "allows the same identifier when it belongs to a different organization" do
      create(:device, organization: other_organization, identifier: "IPHONE-001")

      post_device({ identifier: "IPHONE-001", name: "Alice's iPhone", platform: "ios" })

      expect(response).to have_http_status(:created)
    end
  end

  describe "missing required fields (A4)" do
    it "reports a field-level error for every blank required field at once" do
      post_device({})

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"].keys).to match_array(%w[identifier name platform])
    end
  end

  describe "invalid platform enum (A5)" do
    it "rejects an out-of-enum platform with a 422, never a 500" do
      post_device({ identifier: "IPHONE-002", name: "Some Device", platform: "windows" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("platform" => [ "is not included in the list" ])
    end
  end

  describe "race condition (A13)" do
    # Two genuinely concurrent requests hitting the unique index isn't
    # reliably reproducible under RSpec's transactional-fixtures wrapping
    # (each example runs inside one DB transaction, so a second thread's
    # connection can't see the not-yet-committed organization/user rows).
    # Instead, simulate the losing request's exact failure mode directly:
    # Device#save raising ActiveRecord::RecordNotUnique, which is exactly
    # what a real unique-index collision raises before app-level validation
    # even gets a chance to see it (F3-db.md §3).
    it "rescues a RecordNotUnique from the DB into the same 422 shape as the app-level check (A12)" do
      allow_any_instance_of(Device).to receive(:save).and_raise(
        ActiveRecord::RecordNotUnique.new("duplicate key value violates unique constraint")
      )

      post_device({ identifier: "IPHONE-105", name: "Race Device", platform: "ios" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("identifier" => [ Device::IDENTIFIER_TAKEN_MESSAGE ])
    end
  end
end

RSpec.describe "PATCH /api/v1/devices/:id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def patch_device(id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    patch "/api/v1/devices/#{id}", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A14)" do
    it "rejects an expired token" do
      device = create(:device, organization: organization)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      patch_device(device.id, { name: "New Name" }, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "updating successfully (A6)" do
    it "updates the permitted fields on a non-retired device" do
      device = create(:device, organization: organization, status: :active, platform: :ios)

      patch_device(device.id, { name: "Updated Name", platform: "android", os_version: "9.9.9" })

      expect(response).to have_http_status(:ok)
      expect(body["device"]).to include("name" => "Updated Name", "platform" => "android", "os_version" => "9.9.9")
      expect(device.reload.name).to eq("Updated Name")
    end
  end

  describe "transitioning into retired (A7)" do
    it "succeeds when the device is currently active" do
      device = create(:device, organization: organization, status: :active)

      patch_device(device.id, { status: "retired" })

      expect(response).to have_http_status(:ok)
      expect(body["device"]["status"]).to eq("retired")
      expect(device.reload.status).to eq("retired")
    end
  end

  describe "already-retired device (A8)" do
    it "blocks the update entirely with the exact error message, changing no field" do
      device = create(:device, :retired, organization: organization, name: "Original Name")

      patch_device(device.id, { name: "Hacked Name" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ "Thiết bị đã retired, không thể sửa" ])
      expect(device.reload.name).to eq("Original Name")
    end

    it "blocks even a no-op update (resending the same values)" do
      device = create(:device, :retired, organization: organization)

      patch_device(device.id, { name: device.name, platform: device.platform })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ "Thiết bị đã retired, không thể sửa" ])
    end
  end

  describe "invalid status enum (A9)" do
    it "rejects an out-of-enum status with a 422" do
      device = create(:device, organization: organization, status: :active)

      patch_device(device.id, { status: "deleted" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("status" => [ "is not included in the list" ])
    end
  end

  describe "identifier is immutable (A10)" do
    it "ignores an identifier sent in the update body — 200, identifier unchanged" do
      device = create(:device, organization: organization, identifier: "IPHONE-103")

      patch_device(device.id, { identifier: "IPHONE-999" })

      expect(response).to have_http_status(:ok)
      expect(body["device"]["identifier"]).to eq("IPHONE-103")
      expect(device.reload.identifier).to eq("IPHONE-103")
    end
  end

  describe "cross-organization (A11, CLAUDE.md §4)" do
    it "returns 404, not 403, when the device belongs to another organization" do
      device = create(:device, organization: other_organization, identifier: "IPHONE-777")

      patch_device(device.id, { name: "Hack Attempt" })

      expect(response).to have_http_status(:not_found)
    end
  end
end
