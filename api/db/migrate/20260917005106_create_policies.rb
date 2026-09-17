class CreatePolicies < ActiveRecord::Migration[8.1]
  def change
    create_table :policies do |t|
      t.references :organization, null: false, foreign_key: true, index: false
      t.string :name,   null: false
      t.string :type,   null: false
      t.jsonb  :configuration, null: false
      t.integer :status, null: false, default: 0
      t.timestamps
    end

    add_index :policies, [ :organization_id, :name ], unique: true
    add_index :policies, [ :organization_id, :created_at, :id ]
    add_index :policies, [ :organization_id, :status ]
  end
end
