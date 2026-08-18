import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Eenmalige migratie: maakt Klaverbassie groep aan en kopieert bestaande data
export const ensureMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const migrated = await ctx.db.query("shared")
      .withIndex("by_key", q => q.eq("key", "kj_migration_done"))
      .first();
    if (migrated) {
      const kgRow = await ctx.db.query("shared")
        .withIndex("by_key", q => q.eq("key", "kj_klaverbassie_group_id"))
        .first();
      return kgRow ? kgRow.value : null;
    }

    const groupId = await ctx.db.insert("groups", {
      name: "Klaverbassie",
      joinCode: "klaverbassie",
      createdAt: new Date().toISOString(),
    });

    const dataKeys = ["kj_players","kj_games_active","kj_games_history","kj_tournaments"];
    for (const key of dataKeys) {
      const existing = await ctx.db.query("shared")
        .withIndex("by_key", q => q.eq("key", key))
        .first();
      if (existing) {
        const newKey = `${groupId}:${key}`;
        const alreadyMigrated = await ctx.db.query("shared")
          .withIndex("by_key", q => q.eq("key", newKey))
          .first();
        if (!alreadyMigrated) {
          await ctx.db.insert("shared", { key: newKey, value: existing.value });
        }
      }
    }

    await ctx.db.insert("shared", { key: "kj_klaverbassie_group_id", value: groupId });
    await ctx.db.insert("shared", { key: "kj_migration_done", value: "1" });
    return groupId;
  },
});

// Groep aanmaken — geen account nodig
export const createGroup = mutation({
  args: { name: v.string(), joinCode: v.string() },
  handler: async (ctx, { name, joinCode }) => {
    const trimCode = joinCode.trim().toLowerCase();
    if (!trimCode) throw new Error("Groepscode is verplicht");

    const existing = await ctx.db.query("groups")
      .withIndex("by_joinCode", q => q.eq("joinCode", trimCode))
      .first();
    if (existing && !existing.archivedAt) throw new Error("Deze code is al in gebruik");

    const groupId = await ctx.db.insert("groups", {
      name: name.trim(),
      joinCode: trimCode,
      createdAt: new Date().toISOString(),
    });
    return groupId;
  },
});

// Groep opzoeken via join-code
export const getGroupByCode = query({
  args: { joinCode: v.string() },
  handler: async (ctx, { joinCode }) => {
    const group = await ctx.db.query("groups")
      .withIndex("by_joinCode", q => q.eq("joinCode", joinCode.trim().toLowerCase()))
      .first();
    if (!group || group.archivedAt) return null;
    const imageUrl = group.imageStorageId
      ? await ctx.storage.getUrl(group.imageStorageId as any)
      : null;
    return { _id: group._id, name: group.name, joinCode: group.joinCode, imageUrl };
  },
});

// Groepsinstellingen bijwerken
export const updateGroup = mutation({
  args: {
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    joinCode: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
  },
  handler: async (ctx, { groupId, name, joinCode, imageStorageId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Groep niet gevonden");

    if (joinCode !== undefined) {
      const trimCode = joinCode.trim().toLowerCase();
      const existing = await ctx.db.query("groups")
        .withIndex("by_joinCode", q => q.eq("joinCode", trimCode))
        .first();
      if (existing && existing._id !== groupId && !existing.archivedAt) {
        throw new Error("Deze code is al in gebruik");
      }
      await ctx.db.patch(groupId, { joinCode: trimCode });
    }
    if (name !== undefined) await ctx.db.patch(groupId, { name: name.trim() });
    if (imageStorageId !== undefined) await ctx.db.patch(groupId, { imageStorageId });
  },
});

// Alle groepen ophalen (admin)
export const getAllGroups = query({
  args: {},
  handler: async (ctx) => {
    const groups = await ctx.db.query("groups").collect();
    return groups.map(g => ({
      _id: g._id,
      name: g.name,
      joinCode: g.joinCode,
      createdAt: g.createdAt,
      archivedAt: g.archivedAt,
    }));
  },
});

// Groep archiveren (admin)
export const archiveGroup = mutation({
  args: { groupId: v.id("groups") },
  handler: async (ctx, { groupId }) => {
    await ctx.db.patch(groupId, { archivedAt: new Date().toISOString() });
  },
});
