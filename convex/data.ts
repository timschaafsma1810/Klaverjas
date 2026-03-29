import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Haal alle gedeelde data op (players, games, current)
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
