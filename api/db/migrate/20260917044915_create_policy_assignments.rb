# docs/design/F8-db.md §2.2 — "đúng 1 trong 2" (group_id XOR device_id).
class CreatePolicyAssignments < ActiveRecord::Migration[8.1]
  def change
    create_table :policy_assignments do |t|
      t.references :organization, null: false, foreign_key: true, index: false
      t.references :policy,       null: false, foreign_key: true, index: false
      t.references :group,        foreign_key: true, index: false
      t.references :device,       foreign_key: true, index: false
      t.timestamps
    end

    add_index :policy_assignments, [ :policy_id, :group_id ], unique: true,
              where: "group_id IS NOT NULL",
              name: "index_policy_assignments_on_policy_and_group"
    add_index :policy_assignments, [ :policy_id, :device_id ], unique: true,
              where: "device_id IS NOT NULL",
              name: "index_policy_assignments_on_policy_and_device"
    add_index :policy_assignments, :group_id
    add_index :policy_assignments, :device_id
    add_index :policy_assignments, [ :organization_id, :policy_id ]

    add_check_constraint :policy_assignments,
      "(group_id IS NOT NULL AND device_id IS NULL) OR (group_id IS NULL AND device_id IS NOT NULL)",
      name: "chk_policy_assignments_exactly_one_target"
  end
end
