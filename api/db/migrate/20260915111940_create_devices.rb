class CreateDevices < ActiveRecord::Migration[8.1]
  def change
    create_table :devices do |t|
      # index: false on purpose — the composite unique index below starts
      # with organization_id, so a standalone organization_id index would be
      # a redundant duplicate (leftmost-prefix rule). See
      # docs/design/F2-db.md §2/§3.
      t.references :organization, null: false, foreign_key: true, index: false
      t.string   :identifier, null: false
      t.string   :name,       null: false
      t.integer  :platform,   null: false
      t.string   :os_version
      t.integer  :status,     null: false, default: 0
      t.datetime :last_seen_at

      t.timestamps
    end

    # Unique *within* an Organization, never globally — two orgs may reuse
    # the same identifier (CLAUDE.md §4, docs/design/F2-db.md §1a).
    add_index :devices, [ :organization_id, :identifier ], unique: true
    # Serves the default list query: org-scoped, ORDER BY created_at DESC,
    # id DESC (SoT §12 OQ-2) — index order matches, so no extra sort pass.
    add_index :devices, [ :organization_id, :created_at, :id ]
    add_index :devices, [ :organization_id, :platform ]
    add_index :devices, [ :organization_id, :status ]
  end
end
