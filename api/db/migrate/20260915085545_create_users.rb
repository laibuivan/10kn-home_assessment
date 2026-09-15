class CreateUsers < ActiveRecord::Migration[8.1]
  def change
    create_table :users do |t|
      # index: false — the composite unique index below (organization_id,
      # email) already covers lookups by organization_id alone (leftmost
      # column), so the auto-generated single-column index would just be
      # redundant write overhead (code-review finding).
      t.references :organization, null: false, foreign_key: true, index: false
      t.string :email, null: false
      t.string :password_digest, null: false
      t.integer :status, null: false, default: 0

      t.timestamps
    end

    # Unique per Organization — NOT globally unique (PRD allows 2 orgs to
    # share an email; see docs/design/F0-db.md §1a).
    add_index :users, [ :organization_id, :email ], unique: true
    # Separate non-unique index for the org-less login lookup (F0-db.md §3).
    add_index :users, :email
  end
end
