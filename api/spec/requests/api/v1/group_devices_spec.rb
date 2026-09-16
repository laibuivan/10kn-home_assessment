require "rails_helper"

RSpec.describe "GET /api/v1/groups/:id/devices", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization, name: "Sales Team") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def get_members(group_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    get "/api/v1/groups/#{group_id}/devices", params: params, headers: headers
  end

  def body
    response.parsed_body
  end

  def add_member(a_group, device)
    create(:group_membership, group: a_group, device: device)
  end

  describe "authentication (A30)" do
    it "rejects a request with no Authorization header" do
      get_members(group.id, {}, token: nil)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects an expired token" do
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      get_members(group.id, {}, token: expired)

      expect(response).to have_http_status(:unauthorized)
    end

    it "rejects a token belonging to a user who has been deactivated" do
      token = token_for(user)
      user.update!(status: :inactive)

      get_members(group.id, {}, token: token)

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "listing members" do
    it "returns only the devices that are members of this group" do
      member = create(:device, organization: organization, identifier: "ACME-0001")
      add_member(group, member)
      create(:device, organization: organization, identifier: "ACME-0002")

      get_members(group.id)

      expect(response).to have_http_status(:ok)
      expect(body["devices"].map { |d| d["identifier"] }).to eq([ "ACME-0001" ])
    end

    it "serializes each member with the same nine fields as the device list, and no groups key" do
      add_member(group, create(:device, organization: organization))

      get_members(group.id)

      expect(body["devices"].first.keys).to contain_exactly(
        "id", "identifier", "name", "platform", "os_version", "status", "last_seen_at", "created_at", "updated_at"
      )
    end

    it "sorts by devices.created_at DESC then devices.id DESC (docs/design/F6-db.md §4a)" do
      older = create(:device, organization: organization, created_at: 2.days.ago)
      newer = create(:device, organization: organization, created_at: 1.hour.ago)
      # Added to the group in the opposite order, to prove the sort key is the
      # device's own created_at and not group_memberships.created_at.
      add_member(group, newer)
      add_member(group, older)

      get_members(group.id)

      expect(body["devices"].map { |d| d["id"] }).to eq([ newer.id, older.id ])
    end

    it "breaks a created_at tie by id DESC, so the order is deterministic" do
      at = 3.hours.ago
      first = create(:device, organization: organization, created_at: at)
      second = create(:device, organization: organization, created_at: at)
      add_member(group, first)
      add_member(group, second)

      get_members(group.id)

      expect(body["devices"].map { |d| d["id"] }).to eq([ second.id, first.id ])
    end

    it "returns an empty list with zeroed meta for a group nobody has joined (A19)" do
      get_members(group.id)

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 0, "total_pages" => 0
      )
    end

    it "lists a device that belongs to several groups at once (A24)" do
      other_group = create(:group, organization: organization)
      device = create(:device, organization: organization)
      add_member(group, device)
      add_member(other_group, device)

      get_members(group.id)
      expect(body["devices"].map { |d| d["id"] }).to eq([ device.id ])

      get_members(other_group.id)
      expect(body["devices"].map { |d| d["id"] }).to eq([ device.id ])
    end
  end

  describe "organization isolation (A2, CLAUDE.md §4)" do
    it "returns 404, not 403, for a group belonging to another organization" do
      foreign = create(:group, organization: other_organization)

      get_members(foreign.id)

      expect(response).to have_http_status(:not_found)
      expect(body).to eq("error" => "Not found")
    end

    it "does not leak a single member of the foreign group's list" do
      foreign = create(:group, organization: other_organization)
      add_member(foreign, create(:device, organization: other_organization, identifier: "GLBX-SECRET"))

      get_members(foreign.id)

      expect(response.body).not_to include("GLBX-SECRET")
    end

    # group_memberships carries no org-match validation by design (F6-db.md
    # §1b), so the read path re-applies the boundary itself.
    it "never lists another organization's device, even if a row somehow links it to this group" do
      mine = create(:device, organization: organization, identifier: "ACME-0001")
      foreign_device = create(:device, organization: other_organization, identifier: "GLBX-0001")
      add_member(group, mine)
      GroupMembership.insert!({ group_id: group.id, device_id: foreign_device.id, created_at: Time.current, updated_at: Time.current })

      get_members(group.id)

      expect(body["devices"].map { |d| d["identifier"] }).to eq([ "ACME-0001" ])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "returns 404 for a group id that does not exist (A5)" do
      get_members(999_999)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed group id (A5)" do
      get_members("abc")

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "filtering" do
    before do
      add_member(group, create(:device, :ios, organization: organization, status: :active))
      add_member(group, create(:device, :ios, organization: organization, status: :retired))
      add_member(group, create(:device, :android, organization: organization, status: :active))
      # A non-member that would match every filter — proves the group scope is
      # applied before the filters, not instead of them.
      create(:device, :ios, organization: organization, status: :active)
    end

    it "filters by platform inside the group" do
      get_members(group.id, { platform: "ios" })

      expect(body["devices"].map { |d| d["platform"] }).to all(eq("ios"))
      expect(body["meta"]["total_count"]).to eq(2)
    end

    it "filters by status inside the group" do
      get_members(group.id, { status: "retired" })

      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "combines both filters" do
      get_members(group.id, { platform: "ios", status: "active" })

      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "returns an empty list when the filter matches no member (A18)" do
      get_members(group.id, { platform: "macos" })

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(0)
    end

    it "rejects an unknown platform and status together in one 422, before querying" do
      get_members(group.id, { platform: "windows", status: "sleeping" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "platform" => [ DeviceFilterable::ENUM_ERROR ],
        "status" => [ DeviceFilterable::ENUM_ERROR ]
      )
    end

    it "still 404s a foreign group before it ever validates the filters" do
      foreign = create(:group, organization: other_organization)

      get_members(foreign.id, { platform: "windows" })

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "pagination" do
    it "rejects a non-integer page and a non-positive per_page together" do
      get_members(group.id, { page: "abc", per_page: "0" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "page" => [ Paginatable::PAGINATION_ERROR ],
        "per_page" => [ Paginatable::PAGINATION_ERROR ]
      )
    end

    it "returns 200 with an empty list for a page past the end" do
      add_member(group, create(:device, organization: organization))

      get_members(group.id, { page: 5 })

      expect(response).to have_http_status(:ok)
      expect(body["devices"]).to eq([])
      expect(body["meta"]["total_count"]).to eq(1)
    end

    it "clamps per_page to the maximum instead of erroring" do
      get_members(group.id, { per_page: 500 })

      expect(body["meta"]["per_page"]).to eq(Paginatable::MAX_PER_PAGE)
    end
  end

  describe "a group with 10.000 devices (A17)" do
    # Built with insert_all, not the factory: this is infrastructure data for
    # a scale assertion, and 20.000 ActiveRecord objects would make the
    # example take minutes for no extra coverage.
    def seed_ten_thousand_members!
      now = Time.current
      device_rows = Array.new(10_000) do |i|
        {
          organization_id: organization.id, identifier: "SCALE-#{format('%05d', i)}", name: "Scale #{i}",
          platform: 0, status: 0, created_at: now - i.seconds, updated_at: now
        }
      end
      Device.insert_all(device_rows)
      device_ids = organization.devices.pluck(:id)
      GroupMembership.insert_all(
        device_ids.map { |device_id| { group_id: group.id, device_id: device_id, created_at: now, updated_at: now } }
      )
    end

    it "pages the list instead of returning 10.000 rows, and reports the true total" do
      seed_ten_thousand_members!

      get_members(group.id, { page: 1 })

      expect(response).to have_http_status(:ok)
      expect(body["devices"].size).to eq(20)
      expect(body["meta"]).to eq(
        "current_page" => 1, "per_page" => 20, "total_count" => 10_000, "total_pages" => 500
      )
    end

    it "keeps filtering correct on the scoped set" do
      seed_ten_thousand_members!
      retired = create(:device, organization: organization, status: :retired)
      add_member(group, retired)

      get_members(group.id, { status: "retired" })

      expect(body["meta"]["total_count"]).to eq(1)
      expect(body["devices"].map { |d| d["id"] }).to eq([ retired.id ])
    end
  end
end

RSpec.describe "POST /api/v1/groups/:id/devices", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization, name: "Sales Team") }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  # `as: :json` on purpose: the real client is axios posting a JSON body, and
  # form encoding would quietly turn `device_ids: []` into `[""]` and
  # `device_ids: nil` into an absent key — hiding exactly the malformed-input
  # branches A13 is about.
  def add_devices(group_id, params = {}, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    post "/api/v1/groups/#{group_id}/devices", params: params, headers: headers, as: :json
  end

  def body
    response.parsed_body
  end

  describe "authentication (A30)" do
    it "rejects a request with no Authorization header and adds nothing" do
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ] }, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(GroupMembership.count).to eq(0)
    end

    it "rejects an expired token and adds nothing" do
      device = create(:device, organization: organization)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      add_devices(group.id, { device_ids: [ device.id ] }, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(GroupMembership.count).to eq(0)
    end
  end

  describe "adding successfully" do
    it "creates one membership per device and reports both counts, unwrapped" do
      devices = create_list(:device, 3, organization: organization)

      add_devices(group.id, { device_ids: devices.map(&:id) })

      expect(response).to have_http_status(:ok)
      expect(body).to eq("added_count" => 3, "devices_count" => 3)
      expect(group.devices.pluck(:id)).to match_array(devices.map(&:id))
    end

    it "accepts a flat body, with no wrapper key" do
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:ok)
    end

    it "accepts ids sent as strings, the way a JSON client may serialize them" do
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id.to_s ] })

      expect(response).to have_http_status(:ok)
      expect(body["added_count"]).to eq(1)
    end

    it "adds an inactive device just like an active one — only retired is blocked" do
      device = create(:device, :inactive, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:ok)
      expect(body["added_count"]).to eq(1)
    end

    it "lets the same device join several groups (A24)" do
      other_group = create(:group, organization: organization)
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ] })
      add_devices(other_group.id, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:ok)
      expect(device.reload.groups).to contain_exactly(group, other_group)
    end

    it "counts duplicate ids in one request only once" do
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id, device.id, device.id ] })

      expect(body).to eq("added_count" => 1, "devices_count" => 1)
      expect(GroupMembership.count).to eq(1)
    end
  end

  describe "idempotency (A6, A7)" do
    it "is a successful no-op when the device is already a member (A6)" do
      device = create(:device, organization: organization)
      create(:group_membership, group: group, device: device)

      add_devices(group.id, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:ok)
      expect(body).to eq("added_count" => 0, "devices_count" => 1)
      expect(GroupMembership.count).to eq(1)
    end

    it "does not touch the existing row's timestamps (on_duplicate: :skip)" do
      device = create(:device, organization: organization)
      membership = create(:group_membership, group: group, device: device)
      original_updated_at = membership.updated_at

      travel_to 1.hour.from_now do
        add_devices(group.id, { device_ids: [ device.id ] })
      end

      expect(membership.reload.updated_at).to be_within(1.second).of(original_updated_at)
    end

    it "counts only the genuinely new devices in a mixed batch (A7)" do
      existing = create(:device, organization: organization)
      create(:group_membership, group: group, device: existing)
      fresh = create_list(:device, 2, organization: organization)

      add_devices(group.id, { device_ids: [ existing.id ] + fresh.map(&:id) })

      expect(body).to eq("added_count" => 2, "devices_count" => 3)
      expect(GroupMembership.count).to eq(3)
    end

    it "produces the same state when the identical request is replayed" do
      devices = create_list(:device, 3, organization: organization)

      3.times { add_devices(group.id, { device_ids: devices.map(&:id) }) }

      expect(GroupMembership.count).to eq(3)
      expect(body["devices_count"]).to eq(3)
    end
  end

  describe "retired devices are rejected atomically (A8, A27)" do
    it "refuses the whole batch and adds nothing, even the valid devices" do
      valid = create_list(:device, 2, organization: organization)
      retired = create(:device, :retired, organization: organization, identifier: "ACME-9999")

      add_devices(group.id, { device_ids: valid.map(&:id) + [ retired.id ] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(GroupMembership.count).to eq(0)
    end

    it "names every blocked identifier, ordered deterministically, on the base key" do
      first = create(:device, :retired, organization: organization, identifier: "ACME-0001")
      second = create(:device, :retired, organization: organization, identifier: "ACME-0002")

      # Sent in the opposite order on purpose: the message must not depend on
      # request order (or on whatever order Postgres returns rows in).
      add_devices(group.id, { device_ids: [ second.id, first.id ] })

      expect(body["errors"]).to eq(
        "base" => [ "#{Device::RETIRED_GROUP_MESSAGE}: ACME-0001, ACME-0002" ]
      )
    end

    it "rejects a lone retired device too (A27 — the same branch a UI bypass hits)" do
      retired = create(:device, :retired, organization: organization)

      add_devices(group.id, { device_ids: [ retired.id ] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(GroupMembership.count).to eq(0)
    end

    it "does not mention a retired device belonging to another organization" do
      foreign_retired = create(:device, :retired, organization: other_organization, identifier: "GLBX-SECRET")
      mine = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ mine.id, foreign_retired.id ] })

      expect(response).to have_http_status(:ok)
      expect(response.body).not_to include("GLBX-SECRET")
      expect(body["added_count"]).to eq(1)
    end
  end

  describe "device_ids validation" do
    it "silently drops ids from another organization and adds the rest (A10)" do
      mine = create(:device, organization: organization)
      foreign = create(:device, organization: other_organization)

      add_devices(group.id, { device_ids: [ mine.id, foreign.id ] })

      expect(response).to have_http_status(:ok)
      expect(body).to eq("added_count" => 1, "devices_count" => 1)
      expect(group.devices.pluck(:id)).to eq([ mine.id ])
    end

    it "changes nothing at all in the other organization (A10)" do
      mine = create(:device, organization: organization)
      foreign = create(:device, organization: other_organization)

      add_devices(group.id, { device_ids: [ mine.id, foreign.id ] })

      expect(GroupMembership.where(device_id: foreign.id)).to be_empty
      expect(other_organization.groups).to be_empty
    end

    it "silently drops ids that do not exist anywhere (A10)" do
      mine = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ mine.id, 999_999 ] })

      expect(response).to have_http_status(:ok)
      expect(body["added_count"]).to eq(1)
    end

    it "silently drops non-numeric entries (A10)" do
      mine = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ mine.id, "abc" ] })

      expect(response).to have_http_status(:ok)
      expect(body["added_count"]).to eq(1)
    end

    it "returns 422 when every id was filtered away (A11)" do
      foreign = create(:device, organization: other_organization)

      add_devices(group.id, { device_ids: [ foreign.id, 999_999 ] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "device_ids" => [ Api::V1::GroupDevicesController::NO_VALID_DEVICES_MESSAGE ]
      )
      expect(GroupMembership.count).to eq(0)
    end

    it "returns 422 for an empty array (A13)" do
      add_devices(group.id, { device_ids: [] })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "device_ids" => [ Api::V1::GroupDevicesController::DEVICE_IDS_BLANK_MESSAGE ]
      )
    end

    it "returns 422 when the field is missing entirely (A13)" do
      add_devices(group.id, {})

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("device_ids")
    end

    it "returns 422, not a 500, when device_ids is a string (A13)" do
      add_devices(group.id, { device_ids: "1" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("device_ids")
    end

    it "returns 422, not a 500, when device_ids is an object (A13)" do
      add_devices(group.id, { device_ids: { id: 1 } })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("device_ids")
    end

    it "returns 422, not a 500, when device_ids is null (A13)" do
      add_devices(group.id, { device_ids: nil })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to have_key("device_ids")
    end
  end

  describe "the 500-device cap (A12)" do
    # Real rows with real ids, built with insert_all for speed: the point is
    # that a request which would otherwise succeed completely is refused
    # purely on size, adding nothing.
    def create_devices!(count)
      now = Time.current
      Device.insert_all(
        Array.new(count) do |i|
          {
            organization_id: organization.id, identifier: "CAP-#{format('%04d', i)}", name: "Cap #{i}",
            platform: 0, status: 0, created_at: now, updated_at: now
          }
        end
      )
      organization.devices.pluck(:id)
    end

    it "accepts exactly 500 devices" do
      ids = create_devices!(500)

      add_devices(group.id, { device_ids: ids })

      expect(response).to have_http_status(:ok)
      expect(body["devices_count"]).to eq(500)
    end

    it "rejects 501 devices with 422 and adds none of them" do
      ids = create_devices!(501)

      add_devices(group.id, { device_ids: ids })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "device_ids" => [ Api::V1::GroupDevicesController::DEVICE_IDS_CAP_MESSAGE ]
      )
      expect(GroupMembership.count).to eq(0)
    end

    # plan F6 "Bẫy #4": measuring the cap after the org filter would let a
    # huge array of junk ids through the cap check and pay for coercion plus a
    # query first. Junk ids can never survive the filter, so a cap error here
    # proves the check ran on the raw array.
    it "measures the cap on the raw array, before coercing or querying anything" do
      add_devices(group.id, { device_ids: Array.new(501) { "not-an-id" } })

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq(
        "device_ids" => [ Api::V1::GroupDevicesController::DEVICE_IDS_CAP_MESSAGE ]
      )
    end
  end

  describe "organization isolation (A3, CLAUDE.md §4)" do
    it "returns 404 for a group of another organization and creates no membership" do
      foreign = create(:group, organization: other_organization)
      device = create(:device, organization: organization)

      add_devices(foreign.id, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:not_found)
      expect(body).to eq("error" => "Not found")
      expect(GroupMembership.count).to eq(0)
    end

    it "404s the foreign group before it even looks at a malformed device_ids" do
      foreign = create(:group, organization: other_organization)

      add_devices(foreign.id, { device_ids: "nonsense" })

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 for a group id that does not exist (A5)" do
      device = create(:device, organization: organization)

      add_devices(999_999, { device_ids: [ device.id ] })

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed group id (A5)" do
      device = create(:device, organization: organization)

      add_devices("abc", { device_ids: [ device.id ] })

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "organization_id in the body is ignored (A31)" do
    it "adds to the caller's own group and leaves the other organization untouched" do
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ], organization_id: other_organization.id })

      expect(response).to have_http_status(:ok)
      expect(group.reload.devices.pluck(:id)).to eq([ device.id ])
      expect(other_organization.groups).to be_empty
    end
  end

  describe "RBAC — no roles inside an organization (A32)" do
    it "lets any other active user of the same organization add devices too" do
      colleague = create(:user, organization: organization)
      device = create(:device, organization: organization)

      add_devices(group.id, { device_ids: [ device.id ] }, token: token_for(colleague))

      expect(response).to have_http_status(:ok)
    end
  end
end

RSpec.describe "DELETE /api/v1/groups/:id/devices/:device_id", type: :request do
  let(:organization) { create(:organization, name: "Acme Inc.") }
  let(:user) { create(:user, organization: organization) }
  let(:other_organization) { create(:organization, name: "Globex Corp.") }
  let(:group) { create(:group, organization: organization, name: "Sales Team") }
  let(:device) { create(:device, organization: organization) }

  def token_for(a_user)
    JsonWebToken.encode(user_id: a_user.id, organization_id: a_user.organization_id)
  end

  def remove_device(group_id, device_id, token: token_for(user))
    headers = token ? { "Authorization" => "Bearer #{token}" } : {}
    delete "/api/v1/groups/#{group_id}/devices/#{device_id}", headers: headers
  end

  def body
    response.parsed_body
  end

  describe "authentication (A30)" do
    it "rejects a request with no Authorization header and removes nothing" do
      create(:group_membership, group: group, device: device)

      remove_device(group.id, device.id, token: nil)

      expect(response).to have_http_status(:unauthorized)
      expect(GroupMembership.count).to eq(1)
    end

    it "rejects an expired token and removes nothing" do
      create(:group_membership, group: group, device: device)
      expired = JsonWebToken.encode({ user_id: user.id, organization_id: user.organization_id }, -1)

      remove_device(group.id, device.id, token: expired)

      expect(response).to have_http_status(:unauthorized)
      expect(GroupMembership.count).to eq(1)
    end
  end

  describe "removing successfully" do
    it "returns 204 with an empty body" do
      create(:group_membership, group: group, device: device)

      remove_device(group.id, device.id)

      expect(response).to have_http_status(:no_content)
      expect(response.body).to be_blank
    end

    it "removes exactly that one membership row" do
      create(:group_membership, group: group, device: device)
      other = create(:device, organization: organization)
      create(:group_membership, group: group, device: other)

      remove_device(group.id, device.id)

      expect(GroupMembership.pluck(:device_id)).to eq([ other.id ])
    end

    it "does not delete the device itself" do
      create(:group_membership, group: group, device: device)

      expect { remove_device(group.id, device.id) }.not_to change(Device, :count)
      expect(device.reload).to be_persisted
    end

    it "leaves the device's other group memberships alone (A24)" do
      other_group = create(:group, organization: organization)
      create(:group_membership, group: group, device: device)
      create(:group_membership, group: other_group, device: device)

      remove_device(group.id, device.id)

      expect(device.reload.groups).to contain_exactly(other_group)
    end

    it "removes an inactive device just like an active one" do
      inactive = create(:device, :inactive, organization: organization)
      create(:group_membership, group: group, device: inactive)

      remove_device(group.id, inactive.id)

      expect(response).to have_http_status(:no_content)
    end
  end

  describe "a device that is not a member (A14)" do
    it "returns 404 when the device exists but never joined the group" do
      remove_device(group.id, device.id)

      expect(response).to have_http_status(:not_found)
      expect(body).to eq("error" => "Not found")
    end

    it "returns 404 on the second DELETE of the same pair (A16, sequential case)" do
      create(:group_membership, group: group, device: device)

      remove_device(group.id, device.id)
      expect(response).to have_http_status(:no_content)

      remove_device(group.id, device.id)
      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 when the device is a member of a DIFFERENT group" do
      other_group = create(:group, organization: organization)
      create(:group_membership, group: other_group, device: device)

      remove_device(group.id, device.id)

      expect(response).to have_http_status(:not_found)
      expect(GroupMembership.count).to eq(1)
    end

    it "returns 404 for a device id that does not exist" do
      remove_device(group.id, 999_999)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed device id" do
      remove_device(group.id, "abc")

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "retired devices cannot be removed either (A9, A27)" do
    let(:retired) { create(:device, :retired, organization: organization) }

    it "returns 422 on the base key" do
      create(:group_membership, group: group, device: retired)

      remove_device(group.id, retired.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(body["errors"]).to eq("base" => [ Device::RETIRED_GROUP_MESSAGE ])
    end

    it "leaves the device a member of the group" do
      create(:group_membership, group: group, device: retired)

      remove_device(group.id, retired.id)

      expect(group.reload.devices.pluck(:id)).to eq([ retired.id ])
      expect(GroupMembership.count).to eq(1)
    end

    # The 404 branch comes first on purpose: a retired device that was never a
    # member must not be told it is retired.
    it "still 404s a retired device that is not a member at all" do
      remove_device(group.id, retired.id)

      expect(response).to have_http_status(:not_found)
    end
  end

  describe "organization isolation (A4, CLAUDE.md §4)" do
    it "returns 404 for a group of another organization and removes nothing" do
      foreign_group = create(:group, organization: other_organization)
      foreign_device = create(:device, organization: other_organization)
      create(:group_membership, group: foreign_group, device: foreign_device)

      remove_device(foreign_group.id, foreign_device.id)

      expect(response).to have_http_status(:not_found)
      expect(GroupMembership.count).to eq(1)
      expect(foreign_group.reload.devices.pluck(:id)).to eq([ foreign_device.id ])
    end

    it "returns 404 for a group id that does not exist (A5)" do
      remove_device(999_999, device.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns 404, not a 500, for a malformed group id (A5)" do
      remove_device("abc", device.id)

      expect(response).to have_http_status(:not_found)
    end
  end

  # docs/design/F6-api.md §5 OQ-API-2: under a true double-click both requests
  # can pass the find_by before either DELETE lands. `membership.destroy!`
  # would then answer 204 twice for one deletion; checking the row count the
  # statement actually removed turns the loser into a 404. Simulated
  # deterministically here (the genuinely threaded case lives in the
  # concurrency describe below) by deleting the row inside the window between
  # find_by and delete_all.
  describe "losing the delete race (A16)" do
    it "returns 404, not 204 and not a 500, when another request deleted the row first" do
      create(:group_membership, group: group, device: device)

      allow(GroupMembership).to receive(:find_by).and_wrap_original do |original, *args|
        found = original.call(*args)
        GroupMembership.where(id: found.id).delete_all if found
        found
      end

      remove_device(group.id, device.id)

      expect(response).to have_http_status(:not_found)
      expect(body).to eq("error" => "Not found")
    end
  end

  describe "RBAC — no roles inside an organization (A32)" do
    it "lets any other active user of the same organization remove a device" do
      colleague = create(:user, organization: organization)
      create(:group_membership, group: group, device: device)

      remove_device(group.id, device.id, token: token_for(colleague))

      expect(response).to have_http_status(:no_content)
    end
  end
end

# Genuinely concurrent requests, on their own connections and outside the
# per-example transaction (rows have to be committed for a second connection
# to see them). Everything created here is torn down by hand.
#
# Honest caveat, recorded at docs/plan/F6-group-membership.md T15: the DB may
# well serialize these two requests anyway, in which case the example passes
# without ever exercising the true overlap. It is still worth having — it
# fails loudly if either endpoint raises, deadlocks or double-writes under
# parallel load, and the deterministic simulations above cover the exact race
# windows.
RSpec.describe "concurrent membership writes", type: :request do
  self.use_transactional_tests = false

  let!(:organization) { create(:organization, name: "Acme Inc.") }
  let!(:user) { create(:user, organization: organization) }
  let!(:group) { create(:group, organization: organization, name: "Sales Team") }
  let!(:device) { create(:device, organization: organization) }

  after do
    GroupMembership.delete_all
    Device.delete_all
    Group.delete_all
    User.delete_all
    Organization.delete_all
  end

  def auth_headers
    { "Authorization" => "Bearer #{JsonWebToken.encode(user_id: user.id, organization_id: user.organization_id)}" }
  end

  # Two independent integration sessions, each with its own request/response
  # state, fired from two threads. Each thread checks its connection back in
  # so the pool (5) is never exhausted.
  def in_parallel(&block)
    sessions = [ open_session, open_session ]
    sessions.map { |session|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection { block.call(session) }
      end
    }.map(&:value)
  end

  describe "two requests adding the same device at the same time (A15)" do
    it "creates exactly one row and answers 200 to both, never a 500" do
      # Warm-up: load every constant the request path needs on this thread
      # first, so the parallel threads don't race Zeitwerk instead of the DB.
      post "/api/v1/groups/#{group.id}/devices", params: { device_ids: [ device.id ] }, headers: auth_headers
      GroupMembership.delete_all

      statuses = in_parallel do |session|
        session.post "/api/v1/groups/#{group.id}/devices", params: { device_ids: [ device.id ] }, headers: auth_headers
        session.response.status
      end

      expect(statuses).to eq([ 200, 200 ])
      expect(GroupMembership.where(group_id: group.id, device_id: device.id).count).to eq(1)
    end
  end

  describe "two requests removing the same device at the same time (A16)" do
    it "answers 204 exactly once and 404 to the other, never a 500" do
      GroupMembership.create!(group: group, device: device)
      # Same warm-up rationale, on a pair that is not the one under test.
      spare = create(:device, organization: organization)
      GroupMembership.create!(group: group, device: spare)
      delete "/api/v1/groups/#{group.id}/devices/#{spare.id}", headers: auth_headers

      statuses = in_parallel do |session|
        session.delete "/api/v1/groups/#{group.id}/devices/#{device.id}", headers: auth_headers
        session.response.status
      end

      expect(statuses).to match_array([ 204, 404 ])
      expect(GroupMembership.count).to eq(0)
    end
  end
end
