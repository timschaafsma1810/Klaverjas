import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Haal alle gedeelde data op (players, games, current)
// Foto-URLs worden opgelost via Convex File Storage en meegestuurd als kj_photo_urls
export const getData = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("shared").collect();
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = null;
      }
    }
    // Resolve photo URLs for players with a photoId (Convex File Storage)
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

// Sla een waarde op (aanmaken of bijwerken)
export const saveData = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("shared")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("shared", { key, value });
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

// Verwijder een foto uit Convex File Storage (bij nieuwe upload of speler verwijderen)
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
