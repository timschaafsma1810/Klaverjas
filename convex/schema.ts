import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  shared: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  users: defineTable({
    name: v.string(),
    pinHash: v.string(),
    isAdmin: v.boolean(),
    createdAt: v.string(),
  }).index("by_name", ["name"]),

  groups: defineTable({
    name: v.string(),
    joinCode: v.string(),
    createdBy: v.optional(v.id("users")),
    imageStorageId: v.optional(v.string()),
    createdAt: v.string(),
    archivedAt: v.optional(v.string()),
  }).index("by_joinCode", ["joinCode"]),

  memberships: defineTable({
    userId: v.id("users"),
    groupId: v.id("groups"),
    joinedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_group", ["groupId"])
    .index("by_user_group", ["userId", "groupId"]),
});
