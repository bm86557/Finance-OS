/**
 * @deprecated Decommissioned in Milestone 1. Finance OS operates exclusively on Supabase PostgreSQL.
 * Direct SQLite connections via better-sqlite3 have been eliminated.
 */

export const db: any = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`Direct SQLite access (db.${String(prop)}) is decommissioned. All persistence is strictly Supabase PostgreSQL.`);
  },
});

export const sqlite: any = new Proxy({}, {
  get(_target, prop) {
    throw new Error(`Direct SQLite access (sqlite.${String(prop)}) is decommissioned. All persistence is strictly Supabase PostgreSQL.`);
  },
});
