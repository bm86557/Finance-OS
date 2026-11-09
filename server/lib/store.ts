/**
 * @deprecated Decommissioned in Milestone 1. Finance OS operates exclusively on Supabase PostgreSQL.
 * Any runtime attempt to read or mutate in-memory store throws an explicit error immediately.
 */

export const store: any = new Proxy({}, {
  get(_target, prop) {
    throw new Error(
      `Access to in-memory store.${String(prop)} is prohibited. Finance OS operates exclusively on Supabase PostgreSQL.`
    );
  },
  set(_target, prop) {
    throw new Error(
      `Mutation of in-memory store.${String(prop)} is prohibited. Finance OS operates exclusively on Supabase PostgreSQL.`
    );
  },
});

export const storeReady = Promise.resolve();
