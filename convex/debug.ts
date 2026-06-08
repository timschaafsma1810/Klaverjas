import { internalQuery } from "./_generated/server";
export const checkAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    const groups = await ctx.db.query("groups").collect();
    const migrated = await ctx.db.query("shared").withIndex("by_key", q => q.eq("key", "kj_migration_done")).first();
    const allShared = await ctx.db.query("shared").collect();
    const groupScopedKeys = allShared.filter(r => r.key.includes(":")).map(r => r.key.split(":").slice(1).join(":")).slice(0, 10);
    const legacyKeys = allShared.filter(r => !r.key.includes(":")).map(r => r.key);
    return { users: users.map(u => ({id: u._id, name: u.name, isAdmin: u.isAdmin})), groups: groups.map(g => ({id: g._id, name: g.name, joinCode: g.joinCode})), migrated: !!migrated, groupScopedKeys, legacyKeys };
  }
});
