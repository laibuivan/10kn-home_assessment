# F9 — policy resolution engine (docs/design/F9-api.md §2.5,
# docs/design/F9-db.md §3.1, CLAUDE.md §4 "Policy đang áp dụng trên Device").
#
# Read-only, pure function of current DB state (R5/A18): 2 calls in a row
# with nothing changed in between must return array-equal results, element
# order included — nothing here caches, memoizes across instances, or
# depends on the order Postgres happens to return rows in.
module Devices
  class PolicyResolver
    EXCLUDED_REASON_INACTIVE = "Policy đang inactive, không được tính hiệu lực".freeze
    EXCLUDED_REASON_LOWER_PRIORITY = "Ưu tiên thấp hơn".freeze

    def initialize(device)
      @device = device
    end

    # => Array<Hash> — ready to `render json: { applied_policies: result }`
    # (docs/design/F9-api.md §2.3), one entry per `type` that still has at
    # least one `active` candidate (A9 drops the rest entirely).
    def call
      load_candidates
        .group_by { |candidate| candidate.policy.type }
        .filter_map { |type, candidates| resolve_type(type, candidates) }
        .sort_by { |entry| entry[:type] }
    end

    private

    attr_reader :device

    def current_organization
      device.organization
    end

    # 2-4 fixed DB queries regardless of Group size (docs/design/F9-db.md
    # §3.1-§3.4) — never scales with the number of Device rows inside a
    # Group, only with the number of Group/Device the Policy was assigned
    # to directly.
    def load_candidates
      # `.joins(:group).merge(current_organization.groups)` — 2nd layer of
      # cross-org defense (docs/design/F9-api.md §6.1), not just trusting
      # that F6/F8 always keep group_memberships same-org as the Device.
      group_ids = GroupMembership.joins(:group)
        .merge(current_organization.groups)
        .where(device_id: device.id)
        .pluck(:group_id)

      direct = current_organization.policy_assignments
        .where(device_id: device.id)
        .includes(:policy)
        .to_a

      via_group =
        if group_ids.present?
          current_organization.policy_assignments
            .where(group_id: group_ids)
            .includes(:policy, :group)
            .to_a
        else
          []
        end

      direct + via_group
    end

    # 4-element sort key (docs/design/F9-api.md §2.5) — R2 (direct beats
    # group) -> R3 (newer policy.updated_at wins) -> R4 (lower policy.id
    # wins a tie) -> OQ-3 (lower group_id wins the display badge when the
    # SAME policy_id reaches the device through >= 2 Group, S13). The 4th
    # element is not optional: without it, `min_by` would silently depend on
    # Ruby array order, itself inherited from 2 SQL queries with no explicit
    # ORDER BY — a violation of R5/A18.
    def sort_key(candidate)
      [
        candidate.device_id.present? ? 0 : 1,
        -candidate.policy.updated_at.to_f,
        candidate.policy_id,
        candidate.group_id || Float::INFINITY
      ]
    end

    def resolve_type(type, candidates)
      actives = candidates.select { |candidate| candidate.policy.status == "active" }
      return nil if actives.empty? # A9 — type disappears entirely, not candidates: []

      inactives = candidates - actives
      sorted_actives = actives.sort_by { |candidate| sort_key(candidate) }
      winner = sorted_actives.first
      winning_policy_id = winner.policy_id

      {
        type: type,
        policy: serialize_policy(winner.policy),
        source: serialize_source(winner),
        # R8 — conflict is about the *active* candidate set, independent of
        # whether a winner has already been resolved (S5 has 2 active
        # candidates with equal configuration -> not a conflict; S8 has 2
        # active candidates with different configuration -> conflict, even
        # though the direct assignment always wins the displayed row).
        conflict: actives.map { |candidate| candidate.policy.configuration }.uniq.size > 1,
        candidates: build_candidates(sorted_actives, winning_policy_id, active: true) +
          build_candidates(inactives.sort_by { |candidate| sort_key(candidate) }, winning_policy_id, active: false)
      }
    end

    def build_candidates(rows, winning_policy_id, active:)
      rows.map do |candidate|
        included = active && candidate.policy_id == winning_policy_id
        {
          policy_id: candidate.policy_id,
          name: candidate.policy.name,
          configuration: candidate.policy.configuration,
          status: candidate.policy.status,
          source: serialize_source(candidate),
          included: included,
          excluded_reason: excluded_reason_for(included:, active:)
        }
      end
    end

    def excluded_reason_for(included:, active:)
      return nil if included

      active ? EXCLUDED_REASON_LOWER_PRIORITY : EXCLUDED_REASON_INACTIVE
    end

    def serialize_policy(policy)
      {
        id: policy.id,
        name: policy.name,
        type: policy.type,
        configuration: policy.configuration,
        status: policy.status
      }
    end

    def serialize_source(candidate)
      if candidate.device_id.present?
        { kind: "direct", group: nil }
      else
        { kind: "group", group: { id: candidate.group.id, name: candidate.group.name } }
      end
    end
  end
end
