# docs/design/F6-db.md §2 — the one migration F6 needs: a pure join table
# between groups and devices. No `source`/`status` column (that is F8's
# policy_assignments), no devices_count counter cache on groups (SoT OQ-5 —
# upsert_all skips callbacks, so a counter cache would drift).
class CreateGroupMemberships < ActiveRecord::Migration[8.1]
  def change
    create_table :group_memberships do |t|
      # index: false on both references on purpose — the two explicit indexes
      # below replace Rails' defaults instead of doubling up on them:
      #   * [group_id, device_id] UNIQUE already covers every `WHERE
      #     group_id = ?` through its leftmost prefix (including the
      #     `DELETE ... WHERE group_id = ?` that `dependent: :delete_all`
      #     issues when a Group is destroyed);
      #   * device_id gets its own index, spelled out rather than inherited,
      #     because SoT §3/§8 requires the reverse lookup ("which groups hold
      #     this device") to be indexed and nobody should have to infer that
      #     from a default.
      t.references :group, null: false, foreign_key: true, index: false
      t.references :device, null: false, foreign_key: true, index: false
      t.timestamps
    end

    # The ONLY protection that actually runs on the main write path: the
    # model's uniqueness validation never fires under upsert_all
    # (docs/design/F6-db.md §1b/§3), so this index is mandatory, not a
    # nicety — it is also what `unique_by:` points at.
    add_index :group_memberships, [ :group_id, :device_id ], unique: true
    add_index :group_memberships, :device_id
  end
end
