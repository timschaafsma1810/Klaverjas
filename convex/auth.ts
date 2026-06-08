import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode("kj:" + pin);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export const register = mutation({
  args: { name: v.string(), pin: v.string() },
  handler: async (ctx, { name, pin }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Naam is verplicht");
    if (!pin) throw new ConvexError("PIN/wachtwoord is verplicht");

    const existing = await ctx.db.query("users")
      .withIndex("by_name", q => q.eq("name", trimmed))
      .first();
    if (existing) throw new ConvexError("Deze naam is al in gebruik");

    const pinHash = await hashPin(pin);
    const isAdmin = trimmed.toLowerCase() === "tibbush";
    const userId = await ctx.db.insert("users", {
      name: trimmed,
      pinHash,
      isAdmin,
      createdAt: new Date().toISOString(),
    });
    return { userId, name: trimmed, isAdmin };
  },
});

export const login = mutation({
  args: { name: v.string(), pin: v.string() },
  handler: async (ctx, { name, pin }) => {
    const user = await ctx.db.query("users")
      .withIndex("by_name", q => q.eq("name", name.trim()))
      .first();
    if (!user) throw new ConvexError("Naam niet gevonden");

    const pinHash = await hashPin(pin);
    if (pinHash !== user.pinHash) throw new ConvexError("Verkeerde PIN");

    return { userId: user._id, name: user.name, isAdmin: user.isAdmin };
  },
});

export const resetPin = mutation({
  args: { adminId: v.id("users"), targetId: v.id("users"), newPin: v.string() },
  handler: async (ctx, { adminId, targetId, newPin }) => {
    const admin = await ctx.db.get(adminId);
    if (!admin?.isAdmin) throw new ConvexError("Geen admin rechten");
    const pinHash = await hashPin(newPin);
    await ctx.db.patch(targetId, { pinHash });
  },
});

export const listUsers = query({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }) => {
    const admin = await ctx.db.get(adminId);
    if (!admin?.isAdmin) throw new ConvexError("Geen admin rechten");
    const users = await ctx.db.query("users").collect();
    return users.map(u => ({
      _id: u._id,
      name: u.name,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
    }));
  },
});

export const mergeProfiles = mutation({
  args: {
    adminId: v.id("users"),
    keepId: v.id("users"),
    deleteId: v.id("users"),
  },
  handler: async (ctx, { adminId, keepId, deleteId }) => {
    const admin = await ctx.db.get(adminId);
    if (!admin?.isAdmin) throw new ConvexError("Geen admin rechten");

    const memberships = await ctx.db.query("memberships")
      .withIndex("by_user", q => q.eq("userId", deleteId))
      .collect();

    for (const m of memberships) {
      const exists = await ctx.db.query("memberships")
        .withIndex("by_user_group", q => q.eq("userId", keepId).eq("groupId", m.groupId))
        .first();
      if (!exists) {
        await ctx.db.insert("memberships", {
          userId: keepId,
          groupId: m.groupId,
          joinedAt: m.joinedAt,
        });
      }
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(deleteId);
  },
});
