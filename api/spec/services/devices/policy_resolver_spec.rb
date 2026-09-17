# TDD (CLAUDE.md §3 rule 4) — this file is written and confirmed RED
# (NameError: uninitialized constant Devices::PolicyResolver) before
# app/services/devices/policy_resolver.rb exists. Scenarios below are named
# after docs/sot/F9-policy-resolution.md §11 canonical Scenario order
# (S1-S20, per docs/plan/F9-policy-resolution.md's own numbering) — see
# docs/design/F9-api.md §2.5 for the exact algorithm this pins down.
require "rails_helper"

RSpec.describe Devices::PolicyResolver do
  let(:organization) { create(:organization) }
  let(:device) { create(:device, organization: organization) }

  def resolve
    described_class.new(device).call
  end

  def membership_for(group)
    create(:group_membership, group: group, device: device)
  end

  describe "S1 — Device không có policy nào áp dụng" do
    it "returns an empty array" do
      expect(resolve).to eq([])
    end
  end

  describe "S2 — 1 policy gán trực tiếp" do
    it "returns 1 entry with source direct, not conflicting" do
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: policy)

      result = resolve

      expect(result.size).to eq(1)
      entry = result.first
      expect(entry[:type]).to eq("wifi")
      expect(entry[:policy][:id]).to eq(policy.id)
      expect(entry[:policy][:status]).to eq("active")
      expect(entry[:source]).to eq(kind: "direct", group: nil)
      expect(entry[:conflict]).to eq(false)
      expect(entry[:candidates].size).to eq(1)
      expect(entry[:candidates].first).to eq(
        policy_id: policy.id,
        name: policy.name,
        configuration: policy.configuration,
        status: "active",
        source: { kind: "direct", group: nil },
        included: true,
        excluded_reason: nil
      )
    end
  end

  describe "S3 — 1 policy qua Group" do
    it "returns 1 entry with source group, carrying the group's id/name" do
      group = create(:group, organization: organization, name: "Sales Laptops")
      membership_for(group)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: policy)

      entry = resolve.first

      expect(entry[:source]).to eq(kind: "group", group: { id: group.id, name: "Sales Laptops" })
      expect(entry[:candidates].first[:source]).to eq(kind: "group", group: { id: group.id, name: "Sales Laptops" })
    end
  end

  describe "S4 — 2 type khác nhau không xung đột" do
    it "returns 2 separate entries, neither conflicting" do
      group = create(:group, organization: organization)
      membership_for(group)
      wifi = create(:policy, organization: organization, type: "wifi", status: :active)
      password = create(:policy, organization: organization, type: "password", status: :active)
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: wifi)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: password)

      result = resolve

      expect(result.map { |e| e[:type] }).to eq(%w[password wifi]) # sorted alphabetically
      expect(result.map { |e| e[:conflict] }).to eq([ false, false ])
    end
  end

  describe "S5 / OQ-1 — trực tiếp và group cùng type cùng configuration không tính là conflict thật" do
    it "picks the direct policy as the winning row but conflict stays false" do
      group = create(:group, organization: organization)
      membership_for(group)
      shared_configuration = { "ssid" => "Corp-5G" }
      wifi_a = create(:policy, organization: organization, type: "wifi", status: :active, configuration: shared_configuration)
      wifi_b = create(:policy, organization: organization, type: "wifi", status: :active, configuration: shared_configuration)
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: wifi_a)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: wifi_b)

      entry = resolve.first

      expect(entry[:policy][:id]).to eq(wifi_a.id)
      expect(entry[:source]).to eq(kind: "direct", group: nil)
      expect(entry[:conflict]).to eq(false)
      expect(entry[:candidates].size).to eq(2)
    end
  end

  describe "S6 / R3 — conflict giữa 2 group, updated_at mới nhất thắng" do
    it "picks the more recently updated policy and flags conflict" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      membership_for(group_a)
      membership_for(group_b)
      wifi_old = create(:policy, organization: organization, type: "wifi", status: :active,
                                  configuration: { "ssid" => "Old" }, updated_at: Time.zone.parse("2026-01-01"))
      wifi_new = create(:policy, organization: organization, type: "wifi", status: :active,
                                  configuration: { "ssid" => "New" }, updated_at: Time.zone.parse("2026-06-01"))
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: wifi_old)
      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: wifi_new)

      entry = resolve.first

      expect(entry[:policy][:id]).to eq(wifi_new.id)
      expect(entry[:conflict]).to eq(true)
    end
  end

  describe "S7 / R4 — hòa updated_at, id nhỏ hơn thắng" do
    it "picks the lower id when updated_at ties" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      membership_for(group_a)
      membership_for(group_b)
      tie_time = Time.zone.parse("2026-03-01")
      wifi_x = create(:policy, organization: organization, type: "wifi", status: :active,
                                configuration: { "ssid" => "X" }, updated_at: tie_time)
      wifi_y = create(:policy, organization: organization, type: "wifi", status: :active,
                                configuration: { "ssid" => "Y" }, updated_at: tie_time)
      expect(wifi_x.id).to be < wifi_y.id

      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: wifi_y)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: wifi_x)

      entry = resolve.first

      expect(entry[:policy][:id]).to eq(wifi_x.id)
    end
  end

  describe "S8 / R2 — trực tiếp luôn thắng dù group có updated_at mới hơn" do
    it "picks the direct assignment and still flags conflict" do
      group = create(:group, organization: organization)
      membership_for(group)
      wifi_direct = create(:policy, organization: organization, type: "wifi", status: :active,
                                     configuration: { "ssid" => "Direct" }, updated_at: Time.zone.parse("2026-01-01"))
      wifi_group = create(:policy, organization: organization, type: "wifi", status: :active,
                                    configuration: { "ssid" => "Group" }, updated_at: Time.zone.parse("2026-06-01"))
      create(:policy_assignment, :for_device, organization: organization, device: device, policy: wifi_direct)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: wifi_group)

      entry = resolve.first

      expect(entry[:policy][:id]).to eq(wifi_direct.id)
      expect(entry[:source]).to eq(kind: "direct", group: nil)
      expect(entry[:conflict]).to eq(true)
    end
  end

  describe "S9 / A9 — type chỉ còn candidate inactive không xuất hiện" do
    it "excludes the type entirely from the result" do
      group = create(:group, organization: organization)
      membership_for(group)
      old_wifi = create(:policy, organization: organization, type: "wifi", status: :inactive)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: old_wifi)

      expect(resolve).to eq([])
    end
  end

  describe "S10/S11 / R5 — trạng thái policy đọc lại mỗi lần gọi (deactivate/activate)" do
    it "drops the policy after deactivate and brings it back after re-activate, without touching the assignment" do
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      assignment = create(:policy_assignment, :for_device, organization: organization, device: device, policy: policy)

      expect(resolve.map { |e| e[:type] }).to eq([ "wifi" ])

      policy.update!(status: :inactive)
      expect(resolve).to eq([])

      policy.update!(status: :active)
      expect(resolve.map { |e| e[:type] }).to eq([ "wifi" ])
      expect(PolicyAssignment.exists?(assignment.id)).to eq(true)
    end
  end

  describe "S12 — xóa Group loại bỏ policy của group đó" do
    it "no longer surfaces the policy once the group (and its assignments) is destroyed" do
      group = create(:group, organization: organization)
      membership_for(group)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: organization, group: group, policy: policy)

      expect(resolve.map { |e| e[:type] }).to eq([ "wifi" ])

      group.destroy!

      expect(resolve).to eq([])
    end
  end

  describe "S13 / OQ-3 — cùng 1 policy_id qua 2 group không phải conflict, badge = group_id nhỏ nhất" do
    it "returns exactly 1 entry, not conflicting, both candidates included, badge picks the smaller group_id" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      membership_for(group_a)
      membership_for(group_b)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      # Created in reverse id order on purpose (group_b's assignment first)
      # so a correct implementation cannot depend on SQL/array insertion
      # order — only the explicit group_id tie-break may decide the winner
      # (plan Rủi ro point 1).
      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: policy)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: policy)
      smaller_group = [ group_a, group_b ].min_by(&:id)

      entry = resolve.first

      expect(resolve.size).to eq(1)
      expect(entry[:policy][:id]).to eq(policy.id)
      expect(entry[:conflict]).to eq(false)
      expect(entry[:source]).to eq(kind: "group", group: { id: smaller_group.id, name: smaller_group.name })
      expect(entry[:candidates].size).to eq(2)
      expect(entry[:candidates].map { |c| c[:included] }).to eq([ true, true ])
      expect(entry[:candidates].map { |c| c.dig(:source, :group, :id) }).to contain_exactly(group_a.id, group_b.id)
    end
  end

  describe "S19 / OQ-4 — candidates[] đủ field, đúng 2 excluded_reason cố định, active trước inactive" do
    it "lists winner, loser-active (lower priority) and inactive candidates in that order with the fixed reasons" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      membership_for(group_a)
      membership_for(group_b)
      wifi_new = create(:policy, organization: organization, name: "Wifi New", type: "wifi", status: :active,
                                  configuration: { "ssid" => "New" }, updated_at: Time.zone.parse("2026-06-01"))
      wifi_old = create(:policy, organization: organization, name: "Wifi Old", type: "wifi", status: :active,
                                  configuration: { "ssid" => "Old" }, updated_at: Time.zone.parse("2026-01-01"))
      wifi_inactive = create(:policy, organization: organization, name: "Wifi Inactive", type: "wifi", status: :inactive)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: wifi_new)
      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: wifi_old)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: wifi_inactive)

      entry = resolve.first

      expect(entry[:candidates].map { |c| c[:name] }).to eq([ "Wifi New", "Wifi Old", "Wifi Inactive" ])
      expect(entry[:candidates].map { |c| c[:included] }).to eq([ true, false, false ])
      expect(entry[:candidates].map { |c| c[:excluded_reason] }).to eq(
        [ nil, "Ưu tiên thấp hơn", "Policy đang inactive, không được tính hiệu lực" ]
      )
    end
  end

  describe "S18 / R5 / A18 — gọi lại nhiều lần cho cùng state ra cùng kết quả tuyệt đối" do
    it "returns array-equal results (including element order) across repeated calls with unchanged state" do
      group_a = create(:group, organization: organization)
      group_b = create(:group, organization: organization)
      membership_for(group_a)
      membership_for(group_b)
      policy = create(:policy, organization: organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: organization, group: group_a, policy: policy)
      create(:policy_assignment, :for_group, organization: organization, group: group_b, policy: policy)
      create(:policy_assignment, :for_device, organization: organization, device: device,
                                  policy: create(:policy, organization: organization, type: "password", status: :active))

      first_call = resolve
      second_call = resolve

      expect(first_call).to eq(second_call)
    end
  end

  describe "load_candidates cross-org defense (plan Rủi ro point 3)" do
    it "ignores a group membership row whose group belongs to a different organization" do
      foreign_group = create(:group)
      # Bypass GroupMembership's own validation (none exists for org match —
      # F6-db.md §1b) the same way F6/F8's real write paths do (upsert_all),
      # by inserting the row directly instead of building through
      # associations, so this exercises the read-time defense in isolation.
      GroupMembership.insert!({ group_id: foreign_group.id, device_id: device.id })
      policy = create(:policy, organization: foreign_group.organization, type: "wifi", status: :active)
      create(:policy_assignment, :for_group, organization: foreign_group.organization, group: foreign_group, policy: policy)

      expect(resolve).to eq([])
    end
  end
end
