import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

/**
 * The routing engine queries the DB through the `db` connection module.
 * We mock that module so tests stay pure (no Postgres) and assert the
 * decision logic — currency/amount filtering, max_cost_bps gating, and
 * cost-aware selection.
 */

type Row = Record<string, any>;

interface MockTables {
  routing_rules: Row[];
  provider_accounts: Row[];
}

let mockTables: MockTables;

function mockDb(table: string) {
  // A tiny query-builder shim that supports just enough of Knex's surface
  // for the routing-engine code paths we exercise here.
  const rows: Row[] = (mockTables as any)[table] || [];
  let filters: Array<(r: Row) => boolean> = [];
  let order: { col: string; dir: 'asc' | 'desc' } | null = null;

  const apply = (): Row[] => {
    let out = rows.filter((r) => filters.every((f) => f(r)));
    if (order) {
      out = [...out].sort((a, b) => {
        const va = a[order!.col];
        const vb = b[order!.col];
        return order!.dir === 'asc' ? (va > vb ? 1 : va < vb ? -1 : 0) : vb > va ? 1 : vb < va ? -1 : 0;
      });
    }
    return out;
  };

  const builder: any = {
    where(spec: Row | string, op?: any, val?: any) {
      if (typeof spec === 'string') {
        filters.push((r) => r[spec] === val);
      } else {
        for (const [k, v] of Object.entries(spec)) {
          filters.push((r) => r[k] === v);
        }
      }
      return builder;
    },
    whereNot(spec: Row) {
      for (const [k, v] of Object.entries(spec)) filters.push((r) => r[k] !== v);
      return builder;
    },
    whereNotNull(col: string) {
      filters.push((r) => r[col] != null);
      return builder;
    },
    orderBy(col: string, dir: 'asc' | 'desc' = 'asc') {
      order = { col, dir };
      return builder;
    },
    limit(_n: number) {
      return builder;
    },
    offset(_n: number) {
      return builder;
    },
    first() {
      return Promise.resolve(apply()[0]);
    },
    then(resolve: any) {
      return Promise.resolve(apply()).then(resolve);
    },
  };
  return builder;
}

vi.mock('../db/connection', () => ({
  default: (table: string) => mockDb(table),
}));

// Import AFTER mocking so the engine picks up the mocked db.
let routingEngine: any;

beforeAll(async () => {
  ({ routingEngine } = await import('./routing-engine'));
});

describe('RoutingEngine', () => {
  beforeEach(() => {
    mockTables = { routing_rules: [], provider_accounts: [] };
    vi.spyOn(Math, 'random').mockReturnValue(0); // deterministic weighted pick
  });

  it('returns null when no rules match', async () => {
    mockTables.routing_rules = [
      { id: 'r1', enabled: true, priority: 1, currencies: 'EUR', target_account_id: 'a1', weight: 1 },
    ];
    mockTables.provider_accounts = [{ id: 'a1', status: 'ACTIVE', fee_config: null, weight: 1 }];

    const r = await routingEngine.resolve('m1', 1000, 'USD');
    expect(r).toBeNull();
  });

  it('drops rules whose connector exceeds max_cost_bps', async () => {
    // 2.9% + 30 on 1000 minor units = 320 -> 3200 bps. Rule capped at 600 bps.
    mockTables.routing_rules = [
      {
        id: 'r1',
        enabled: true,
        priority: 1,
        currencies: 'USD',
        target_account_id: 'expensive',
        weight: 1,
        max_cost_bps: 600,
      },
      {
        id: 'r2',
        enabled: true,
        priority: 2,
        currencies: 'USD',
        target_account_id: 'cheap',
        weight: 1,
      },
    ];
    mockTables.provider_accounts = [
      { id: 'expensive', status: 'ACTIVE', fee_config: JSON.stringify({ fixed: 30, percentage: 2.9 }) },
      { id: 'cheap', status: 'ACTIVE', fee_config: JSON.stringify({ fixed: 0, percentage: 1 }) },
    ];

    const r = await routingEngine.resolve('m1', 1000, 'USD');
    expect(r?.primary?.id).toBe('cheap');
  });

  it('cost-aware mode picks the cheapest survivor', async () => {
    mockTables.routing_rules = [
      { id: 'r1', enabled: true, priority: 1, currencies: 'USD', target_account_id: 'a1', weight: 99 }, // heavy weight, but expensive
      { id: 'r2', enabled: true, priority: 2, currencies: 'USD', target_account_id: 'a2', weight: 1 },
      { id: 'r3', enabled: true, priority: 3, currencies: 'USD', target_account_id: 'a3', weight: 1 },
    ];
    mockTables.provider_accounts = [
      { id: 'a1', status: 'ACTIVE', fee_config: JSON.stringify({ fixed: 50, percentage: 3 }) },
      { id: 'a2', status: 'ACTIVE', fee_config: JSON.stringify({ fixed: 30, percentage: 2.9 }) },
      { id: 'a3', status: 'ACTIVE', fee_config: JSON.stringify({ fixed: 0, percentage: 1 }) }, // cheapest
    ];

    const r = await routingEngine.resolve('m1', 10_000, 'USD', null, 'card', { costAware: true });
    expect(r?.primary?.id).toBe('a3');
  });

  it('matches currency, amount range, country and payment method', async () => {
    mockTables.routing_rules = [
      {
        id: 'r1',
        enabled: true,
        priority: 1,
        currencies: 'USD,EUR',
        amount_min: 500,
        amount_max: 5000,
        country_codes: 'US',
        payment_method_types: 'card',
        target_account_id: 'a1',
        weight: 1,
      },
    ];
    mockTables.provider_accounts = [{ id: 'a1', status: 'ACTIVE', fee_config: null }];

    expect((await routingEngine.resolve('m1', 1000, 'USD', 'US', 'card'))?.primary?.id).toBe('a1');
    // currency mismatch
    expect(await routingEngine.resolve('m1', 1000, 'GBP', 'US', 'card')).toBeNull();
    // amount below range
    expect(await routingEngine.resolve('m1', 100, 'USD', 'US', 'card')).toBeNull();
    // wrong country
    expect(await routingEngine.resolve('m1', 1000, 'USD', 'CA', 'card')).toBeNull();
    // wrong payment method
    expect(await routingEngine.resolve('m1', 1000, 'USD', 'US', 'wallet')).toBeNull();
  });
});
