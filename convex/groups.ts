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

    // Maak Klaverbassie groep aan (zonder eigenaar — Tibbush registreert zichzelf)
    const groupId = await ctx.db.insert("groups", {
      name: "Klaverbassie",
      joinCode: "klaverbassie",
      createdAt: new Date().toISOString(),
    });

    // Kopieer bestaande data naar groep-specifieke sleutels
    const dataKeys = [
      "kj_players",
      "kj_games_active",
      "kj_games_history",
      "kj_tournaments",
    ];
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

    // Sla groep-ID op voor referentie
    await ctx.db.insert("shared", {
      key: "kj_klaverbassie_group_id",
      value: groupId,
    });
    await ctx.db.insert("shared", {
      key: "kj_migration_done",
      value: "1",
    });

    return groupId;
  },
});

export const createGroup = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    joinCode: v.string(),
  },
  handler: async (ctx, { userId, name, joinCode }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Gebruiker niet gevonden");

    const trimCode = joinCode.trim().toLowerCase();
    if (!trimCode) throw new Error("Groepscode is verplicht");

    const existing = await ctx.db.query("groups")
      .withIndex("by_joinCode", q => q.eq("joinCode", trimCode))
      .first();
    if (existing && !existing.archivedAt) throw new Error("Deze code is al in gebruik");

    const groupId = await ctx.db.insert("groups", {
      name: name.trim(),
      joinCode: trimCode,
      createdBy: userId,
      createdAt: new Date().toISOString(),
    });

    await ctx.db.insert("memberships", {
      userId,
      groupId,
      joinedAt: new Date().toISOString(),
    });

    return groupId;
  },
});

export const joinGroup = mutation({
  args: { userId: v.id("users"), joinCode: v.string() },
  handler: async (ctx, { userId, joinCode }) => {
    const group = await ctx.db.query("groups")
      .withIndex("by_joinCode", q => q.eq("joinCode", joinCode.trim().toLowerCase()))
      .first();
    if (!group || group.archivedAt) throw new Error("Groep niet gevonden — controleer de code");

    const existing = await ctx.db.query("memberships")
      .withIndex("by_user_group", q => q.eq("userId", userId).eq("groupId", group._id))
      .first();
    if (existing) return group._id;

    await ctx.db.insert("memberships", {
      userId,
      groupId: group._id,
      joinedAt: new Date().toISOString(),
    });

    return group._id;
  },
});

export const getMyGroups = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();

    const groups = [];
    for (const m of memberships) {
      const group = await ctx.db.get(m.groupId);
      if (!group || group.archivedAt) continue;

      const imageUrl = group.imageStorageId
        ? await ctx.storage.getUrl(group.imageStorageId as any)
        : null;

      const allMembers = await ctx.db.query("memberships")
        .withIndex("by_group", q => q.eq("groupId", group._id))
        .collect();

      groups.push({
        _id: group._id,
        name: group.name,
        joinCode: group.joinCode,
        createdBy: group.createdBy,
        imageStorageId: group.imageStorageId,
        imageUrl,
        memberCount: allMembers.length,
        isCreator: group.createdBy === userId,
        createdAt: group.createdAt,
      });
    }
    return groups;
  },
});

export const updateGroup = mutation({
  args: {
    userId: v.id("users"),
    groupId: v.id("groups"),
    name: v.optional(v.string()),
    joinCode: v.optional(v.string()),
    imageStorageId: v.optional(v.string()),
  },
  handler: async (ctx, { userId, groupId, name, joinCode, imageStorageId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Groep niet gevonden");

    const user = await ctx.db.get(userId);
    if (group.createdBy !== userId && !user?.isAdmin) throw new Error("Geen rechten");

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

export const removeMember = mutation({
  args: {
    requesterId: v.id("users"),
    targetUserId: v.id("users"),
    groupId: v.id("groups"),
  },
  handler: async (ctx, { requesterId, targetUserId, groupId }) => {
    const group = await ctx.db.get(groupId);
    if (!group) throw new Error("Groep niet gevonden");

    const requester = await ctx.db.get(requesterId);
    if (group.createdBy !== requesterId && !requester?.isAdmin) {
      throw new Error("Geen rechten");
    }

    const membership = await ctx.db.query("memberships")
      .withIndex("by_user_group", q =>
        q.eq("userId", targetUserId).eq("groupId", groupId)
      )
      .first();
    if (membership) await ctx.db.delete(membership._id);
  },
});

export const archiveGroup = mutation({
  args: { adminId: v.id("users"), groupId: v.id("groups") },
  handler: async (ctx, { adminId, groupId }) => {
    const admin = await ctx.db.get(adminId);
    if (!admin?.isAdmin) throw new Error("Geen admin rechten");
    await ctx.db.patch(groupId, { archivedAt: new Date().toISOString() });
  },
});

export const getAllGroups = query({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }) => {
    const admin = await ctx.db.get(adminId);
    if (!admin?.isAdmin) throw new Error("Geen admin rechten");

    const groups = await ctx.db.query("groups").collect();
    return Promise.all(groups.map(async g => {
      const members = await ctx.db.query("memberships")
        .withIndex("by_group", q => q.eq("groupId", g._id))
        .collect();
      const memberNames = [];
      for (const m of members) {
        const u = await ctx.db.get(m.userId);
        if (u) memberNames.push(u.name);
      }
      return {
        _id: g._id,
        name: g.name,
        joinCode: g.joinCode,
        memberCount: members.length,
        memberNames,
        createdAt: g.createdAt,
        archivedAt: g.archivedAt,
      };
    }));
  },
});

export const getGroupMembers = query({
  args: { userId: v.id("users"), groupId: v.id("groups") },
  handler: async (ctx, { userId, groupId }) => {
    const isMember = await ctx.db.query("memberships")
      .withIndex("by_user_group", q => q.eq("userId", userId).eq("groupId", groupId))
      .first();
    const user = await ctx.db.get(userId);
    if (!isMember && !user?.isAdmin) throw new Error("Geen toegang");

    const group = await ctx.db.get(groupId);
    const memberships = await ctx.db.query("memberships")
      .withIndex("by_group", q => q.eq("groupId", groupId))
      .collect();

    const members = [];
    for (const m of memberships) {
      const u = await ctx.db.get(m.userId);
      if (u) {
        members.push({
          userId: u._id,
          name: u.name,
          joinedAt: m.joinedAt,
          isCreator: group?.createdBy === u._id,
        });
      }
    }
    return members;
  },
});
