# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_09_16_141716) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "devices", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "identifier", null: false
    t.datetime "last_seen_at"
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.string "os_version"
    t.integer "platform", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "created_at", "id"], name: "index_devices_on_organization_id_and_created_at_and_id"
    t.index ["organization_id", "identifier"], name: "index_devices_on_organization_id_and_identifier", unique: true
    t.index ["organization_id", "platform"], name: "index_devices_on_organization_id_and_platform"
    t.index ["organization_id", "status"], name: "index_devices_on_organization_id_and_status"
  end

  create_table "group_memberships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "device_id", null: false
    t.bigint "group_id", null: false
    t.datetime "updated_at", null: false
    t.index ["device_id"], name: "index_group_memberships_on_device_id"
    t.index ["group_id", "device_id"], name: "index_group_memberships_on_group_id_and_device_id", unique: true
  end

  create_table "groups", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "description"
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "created_at", "id"], name: "index_groups_on_organization_id_and_created_at_and_id"
    t.index ["organization_id", "name"], name: "index_groups_on_organization_id_and_name", unique: true
  end

  create_table "organizations", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.datetime "updated_at", null: false
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.bigint "organization_id", null: false
    t.string "password_digest", null: false
    t.integer "status", default: 0, null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email"
    t.index ["organization_id", "email"], name: "index_users_on_organization_id_and_email", unique: true
  end

  add_foreign_key "devices", "organizations"
  add_foreign_key "group_memberships", "devices"
  add_foreign_key "group_memberships", "groups"
  add_foreign_key "groups", "organizations"
  add_foreign_key "users", "organizations"
end
