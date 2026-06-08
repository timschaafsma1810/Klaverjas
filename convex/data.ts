import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Haal alle gedeelde data op voor een specifieke groep
export const getData = query({
  args: { groupId: v.optional(v.id("groups")) },
  handler: async (ctx, { groupId }) => {
    if (!groupId) return {};

    const prefix = groupId + ":";
    const rows = await ctx.db.query("shared").collect();
    const result: Record<string, unknown> = {};

    for (const row of rows) {
      if (row.key.startsWith(prefix)) {
        const shortKey = row.key.slice(prefix.length);
        try {
          result[shortKey] = JSON.parse(row.value);
        } catch {
          result[shortKey] = null;
        }
      }
    }

    // Resolve foto-URLs via Convex File Storage
    const players = (result["kj_players"] as { id: number; photoId?: string }[]) ?? [];
    const photoUrls: Record<string, string | null> = {};
    for (const p of players) {
      if (p.photoId) {
        photoUrls[p.photoId] = await ctx.storage.getUrl(p.photoId as any);
      }
    }
    result["kj_photo_urls"] = photoUrls;

    return result;
  },
});

// Sla een waarde op voor een specifieke groep
export const saveData = mutation({
  args: {
    key: v.string(),
    value: v.string(),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, { key, value, groupId }) => {
    const fullKey = groupId ? `${groupId}:${key}` : key;
    const existing = await ctx.db
      .query("shared")
      .withIndex("by_key", (q) => q.eq("key", fullKey))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("shared", { key: fullKey, value });
    }
  },
});

// Genereer een tijdelijke upload-URL voor Convex File Storage
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

// Verwijder een foto uit Convex File Storage
export const deletePhoto = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    try {
      await ctx.storage.delete(storageId as any);
    } catch {
      // Bestand bestaat niet meer — geen probleem
    }
  },
});
