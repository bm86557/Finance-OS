/**
 * @deprecated Decommissioned in Milestone 1. Finance OS operates exclusively on Supabase PostgreSQL.
 * SQLite schema definitions are removed.
 */

export const appBundle: any = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`SQLite appBundle.${String(prop)} is decommissioned. All persistence is strictly Supabase PostgreSQL.`);
  },
});
