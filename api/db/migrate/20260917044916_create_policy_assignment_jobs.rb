# docs/design/F8-db.md §2.3 — `group_id` nullable on purpose (§1c: supports
# `dependent: :nullify` so a job survives its Group being deleted).
class CreatePolicyAssignmentJobs < ActiveRecord::Migration[8.1]
  def change
    create_table :policy_assignment_jobs do |t|
      t.references :organization, null: false, foreign_key: true, index: false
      t.references :policy,       null: false, foreign_key: true, index: false
      t.references :group,        foreign_key: true, index: false # nullable — see docs/design/F8-db.md §1c
      t.integer :status,          null: false, default: 0
      t.integer :total_count,     null: false, default: 0
      t.integer :processed_count, null: false, default: 0
      t.text :error_message
      t.timestamps
    end

    add_index :policy_assignment_jobs, [ :group_id, :status ]
    add_index :policy_assignment_jobs, :organization_id
    add_index :policy_assignment_jobs, [ :policy_id, :group_id ]
  end
end
