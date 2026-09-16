class CreateGroups < ActiveRecord::Migration[8.1]
  def change
    create_table :groups do |t|
      # index: false on purpose — both composite indexes below start with
      # organization_id, so Rails' default standalone index would be a
      # redundant duplicate (leftmost-prefix rule). Same decision as
      # `devices` (docs/design/F5-db.md §2, F2-db.md §2).
      t.references :organization, null: false, foreign_key: true, index: false
      t.string :name, null: false
      t.text   :description

      t.timestamps
    end

    # Unique *within* an Organization, never globally — two orgs may reuse
    # the same group name (CLAUDE.md §4, docs/design/F5-db.md §1a). Also the
    # DB-level backstop that turns a create/rename race into
    # ActiveRecord::RecordNotUnique instead of a duplicate row.
    add_index :groups, [ :organization_id, :name ], unique: true
    # Serves the default list query: org-scoped, ORDER BY created_at DESC,
    # id DESC (SoT F5 §12 OQ-7) — index order matches, so no extra sort pass.
    add_index :groups, [ :organization_id, :created_at, :id ]
  end
end
