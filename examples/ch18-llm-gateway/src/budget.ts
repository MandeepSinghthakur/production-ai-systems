// Reserve pessimistically at admission, reconcile to actual on
// completion. Overshoot becomes bounded by in-flight concurrency times
// per-request maximum. See Chapter 18, "Failure: budget overshoot".

interface Account {
  limitTokens: number;
  spentTokens: number;
  reservedTokens: number;
  hard: boolean;
}

const accounts = new Map<string, Account>();

export const budget = {
  seed(tenant: string, limitTokens: number, hard: boolean): void {
    accounts.set(tenant, {
      limitTokens,
      spentTokens: 0,
      reservedTokens: 0,
      hard,
    });
  },

  /** Returns a reservation id, or null if the tenant is out of room. */
  reserve(tenant: string, estimate: number): number | null {
    const a = accounts.get(tenant);
    if (!a) return 0; // unknown tenant: fail open, alert elsewhere
    const committed = a.spentTokens + a.reservedTokens;
    if (a.hard && committed + estimate > a.limitTokens) return null;
    a.reservedTokens += estimate;
    return estimate;
  },

  settle(tenant: string, reserved: number, actual: number): void {
    const a = accounts.get(tenant);
    if (!a) return;
    a.reservedTokens = Math.max(0, a.reservedTokens - reserved);
    a.spentTokens += actual;
  },

  headroom(tenant: string): number {
    const a = accounts.get(tenant);
    if (!a) return Infinity;
    return a.limitTokens - a.spentTokens - a.reservedTokens;
  },

  all(): Record<string, Account> {
    return Object.fromEntries(accounts);
  },
};
