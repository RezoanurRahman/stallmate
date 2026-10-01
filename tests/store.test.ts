import { describe, expect, it } from 'vitest';
import { MarketStore, NotFoundError, ValidationError } from '../src/server/store';
import {
  ACTIVITY_KINDS,
  MARKET_STATUSES,
  VENDOR_STATUSES,
  type CreateVendorInput,
  type MarketStatus,
  type VendorStatus,
} from '../src/server/types';

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const seedMarketIds = ['mkt-harvest-cedar', 'mkt-lantern-late', 'mkt-makers-riverside'];

describe('MarketStore seeded data', () => {
  it('seeds three well-formed markets with stable ids', () => {
    const store = new MarketStore();
    const markets = store.listMarkets();

    expect(markets).toHaveLength(3);
    expect(markets.map((market) => market.id).sort()).toEqual(seedMarketIds);

    for (const market of markets) {
      expect(MARKET_STATUSES).toContain(market.status);
      expect(market.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(market.name.trim()).not.toBe('');
      expect(market.venue.trim()).not.toBe('');
      expect(market.neighborhood.trim()).not.toBe('');
      expect(market.capacity).toBeGreaterThan(0);
      expect(market.createdAt).toMatch(ISO_TIMESTAMP);
    }
  });

  it('links every seeded vendor and task to a seeded market', () => {
    const store = new MarketStore();
    const marketIds = new Set(store.listMarkets().map((market) => market.id));
    const vendors = store.listVendors();
    const tasks = store.listTasks();

    expect(vendors).toHaveLength(9);
    expect(tasks).toHaveLength(10);
    expect(new Set(vendors.map((vendor) => vendor.id)).size).toBe(vendors.length);
    expect(new Set(tasks.map((task) => task.id)).size).toBe(tasks.length);

    for (const vendor of vendors) {
      expect(marketIds.has(vendor.marketId)).toBe(true);
      expect(VENDOR_STATUSES).toContain(vendor.status);
      expect(vendor.createdAt).toMatch(ISO_TIMESTAMP);
    }
    for (const task of tasks) {
      expect(marketIds.has(task.marketId)).toBe(true);
      expect(task.title.trim()).not.toBe('');
      expect(task.createdAt).toMatch(ISO_TIMESTAMP);
    }

    expect(store.listVendors('mkt-lantern-late')).toHaveLength(2);
    expect(store.listVendors('mkt-makers-riverside')).toHaveLength(4);
    expect(store.listVendors('mkt-harvest-cedar')).toHaveLength(3);
    expect(store.listTasks('mkt-lantern-late')).toHaveLength(2);
    expect(store.listTasks('mkt-makers-riverside')).toHaveLength(5);
    expect(store.listTasks('mkt-harvest-cedar')).toHaveLength(3);
  });

  it('starts with a stable activity feed covering every activity kind', () => {
    const store = new MarketStore();
    const activity = store.listActivity();

    expect(activity).toHaveLength(11);
    expect(new Set(activity.map((entry) => entry.id)).size).toBe(activity.length);
    expect(new Set(activity.map((entry) => entry.kind))).toEqual(new Set(ACTIVITY_KINDS));

    for (const entry of activity) {
      expect(entry.message.trim()).not.toBe('');
      expect(entry.timestamp).toMatch(ISO_TIMESTAMP);
    }
  });
});

describe('MarketStore dashboard', () => {
  it('derives metrics from the seeded records', () => {
    const store = new MarketStore();
    const dashboard = store.dashboard();
    const completedTasks = dashboard.tasks.filter((task) => task.completed).length;

    expect(dashboard.markets).toHaveLength(3);
    expect(dashboard.vendors).toHaveLength(9);
    expect(dashboard.tasks).toHaveLength(10);
    expect(dashboard.activity).toHaveLength(11);

    expect(dashboard.metrics.upcomingMarkets).toBe(
      dashboard.markets.filter((market) => market.status !== 'complete').length,
    );
    expect(dashboard.metrics.totalVendors).toBe(dashboard.vendors.length);
    expect(dashboard.metrics.openTasks).toBe(dashboard.tasks.length - completedTasks);

    expect(dashboard.metrics.upcomingMarkets).toBe(2);
    expect(dashboard.metrics.totalVendors).toBe(9);
    expect(dashboard.metrics.openTasks).toBe(5);
    expect(dashboard.metrics.readiness).toBe(
      Math.round((completedTasks / dashboard.tasks.length) * 100),
    );
    expect(dashboard.metrics.readiness).toBeGreaterThanOrEqual(0);
    expect(dashboard.metrics.readiness).toBeLessThanOrEqual(100);
    expect(Number.isInteger(dashboard.metrics.readiness)).toBe(true);
  });

  it('keeps dashboard lists in sync with the store list methods', () => {
    const store = new MarketStore();
    const dashboard = store.dashboard();

    expect(dashboard.markets.map((market) => market.id)).toEqual(
      store.listMarkets().map((market) => market.id),
    );
    expect(dashboard.vendors.map((vendor) => vendor.id)).toEqual(
      store.listVendors().map((vendor) => vendor.id),
    );
    expect(dashboard.tasks.map((task) => task.id)).toEqual(
      store.listTasks().map((task) => task.id),
    );
    expect(dashboard.activity.map((entry) => entry.id)).toEqual(
      store.listActivity().map((entry) => entry.id),
    );
  });
});

describe('MarketStore market workflow', () => {
  it('updates market status in place and records the change as activity', () => {
    const store = new MarketStore();
    const activityBefore = store.listActivity().length;

    const updated = store.updateMarketStatus('mkt-harvest-cedar', 'confirmed');

    expect(updated).toMatchObject({ id: 'mkt-harvest-cedar', status: 'confirmed' });
    expect(store.getMarket('mkt-harvest-cedar').status).toBe('confirmed');
    expect(store.getMarket('mkt-makers-riverside').status).toBe('confirmed');
    expect(store.getMarket('mkt-lantern-late').status).toBe('complete');

    const activity = store.listActivity();
    expect(activity).toHaveLength(activityBefore + 1);
    expect(
      activity.some(
        (entry) => entry.kind === 'market' && entry.message.includes('Harvest & Handmade'),
      ),
    ).toBe(true);
  });

  it('creates a market with defaults and rejects duplicates', () => {
    const store = new MarketStore();
    const input = {
      name: 'Night Bazaar',
      date: '2026-11-07',
      venue: 'Dockside Shed',
      neighborhood: 'Harbour',
    };

    const created = store.createMarket(input);

    expect(created.id).toMatch(/^mkt-/);
    expect(created).toMatchObject({ ...input, status: 'planning', capacity: 20, notes: '' });
    expect(created.createdAt).toMatch(ISO_TIMESTAMP);
    expect(store.listMarkets()).toHaveLength(4);
    expect(store.getMarket(created.id)).toEqual(created);

    expect(() => store.createMarket({ ...input, venue: 'Elsewhere' })).toThrow(ValidationError);
    expect(() => store.createMarket({ ...input, name: '   ', date: '2026-11-08' })).toThrow(/name/);
  });

  it('fails with clear errors for missing markets and invalid statuses', () => {
    const store = new MarketStore();
    const invalidStatus: string = 'paused';

    expect(() => store.getMarket('mkt-missing')).toThrow(NotFoundError);
    expect(() => store.getMarket('mkt-missing')).toThrow(/Market not found: mkt-missing/);
    expect(() => store.updateMarketStatus('mkt-missing', 'live')).toThrow(NotFoundError);
    expect(() =>
      store.updateMarketStatus('mkt-makers-riverside', invalidStatus as MarketStatus),
    ).toThrow(ValidationError);
    expect(() =>
      store.updateMarketStatus('mkt-makers-riverside', invalidStatus as MarketStatus),
    ).toThrow(/Invalid market status/);
    expect(store.getMarket('mkt-makers-riverside').status).toBe('confirmed');
  });
});

describe('MarketStore vendor workflow', () => {
  it('creates a vendor with defaults and attaches it to its market', () => {
    const store = new MarketStore();

    const created = store.createVendor({
      marketId: 'mkt-harvest-cedar',
      name: 'Copper Kettles',
      category: 'Homeware',
      stall: 'A5',
      contact: 'Rae Cooper · rae@copperkettles.example',
    });

    expect(created.id).toMatch(/^vnd-/);
    expect(created).toMatchObject({
      marketId: 'mkt-harvest-cedar',
      name: 'Copper Kettles',
      category: 'Homeware',
      stall: 'A5',
      fee: 0,
      status: 'pending',
      checkedIn: false,
    });
    expect(created.createdAt).toMatch(ISO_TIMESTAMP);

    expect(store.listVendors()).toHaveLength(10);
    expect(store.listVendors('mkt-harvest-cedar')).toHaveLength(4);
    expect(store.getVendor(created.id)).toEqual(created);
  });

  it('mutates vendor status and check-in state independently', () => {
    const store = new MarketStore();

    const checkedIn = store.updateVendor('vnd-fern-ink', { checkedIn: true });
    expect(checkedIn.checkedIn).toBe(true);
    expect(checkedIn.status).toBe('pending');

    const promoted = store.updateVendor('vnd-fern-ink', { status: 'confirmed', checkedIn: false });
    expect(promoted.status).toBe('confirmed');
    expect(promoted.checkedIn).toBe(false);
    expect(store.getVendor('vnd-fern-ink')).toEqual(promoted);
  });

  it('rejects unknown markets, unknown vendors, and invalid updates', () => {
    const store = new MarketStore();
    const invalidStatus: string = 'expired';
    const invalidFlag: unknown = 'yes';
    const unknownMarketVendor: CreateVendorInput = {
      marketId: 'mkt-missing',
      name: 'Nomad Goods',
      category: 'Craft',
      stall: 'Z9',
      contact: 'nobody@example.test',
    };

    expect(() => store.createVendor(unknownMarketVendor)).toThrow(NotFoundError);
    expect(() => store.createVendor(unknownMarketVendor)).toThrow(/market not found/i);
    expect(() => store.listVendors('mkt-missing')).toThrow(NotFoundError);
    expect(() => store.updateVendor('vnd-missing', { checkedIn: true })).toThrow(NotFoundError);
    expect(() =>
      store.updateVendor('vnd-fern-ink', { status: invalidStatus as VendorStatus }),
    ).toThrow(ValidationError);
    expect(() => store.updateVendor('vnd-fern-ink', { checkedIn: invalidFlag as boolean })).toThrow(
      ValidationError,
    );
    expect(() => store.updateVendor('vnd-fern-ink', {})).toThrow(/status or checkedIn/);
    expect(store.getVendor('vnd-fern-ink').status).toBe('pending');
  });
});

describe('MarketStore task workflow', () => {
  it('completes and reopens a task while keeping metrics in sync', () => {
    const store = new MarketStore();
    const metricsBefore = store.dashboard().metrics;
    expect(metricsBefore.openTasks).toBe(5);

    const completed = store.updateTaskCompletion('tsk-riverside-cards', true);
    expect(completed.completed).toBe(true);
    expect(store.getTask('tsk-riverside-cards').completed).toBe(true);
    expect(store.listTasks('mkt-makers-riverside').filter((task) => !task.completed)).toHaveLength(
      2,
    );
    expect(store.dashboard().metrics.openTasks).toBe(4);
    expect(store.dashboard().metrics.readiness).toBeGreaterThan(metricsBefore.readiness);

    const reopened = store.updateTaskCompletion('tsk-riverside-cards', false);
    expect(reopened.completed).toBe(false);
    expect(store.dashboard().metrics).toEqual(metricsBefore);
  });

  it('rejects unknown tasks, unknown market filters, and non-boolean completion', () => {
    const store = new MarketStore();
    const invalidCompleted: unknown = 'yes';

    expect(() => store.updateTaskCompletion('tsk-missing', true)).toThrow(NotFoundError);
    expect(() => store.listTasks('mkt-missing')).toThrow(NotFoundError);
    expect(() =>
      store.updateTaskCompletion('tsk-riverside-cards', invalidCompleted as boolean),
    ).toThrow(ValidationError);
    expect(store.getTask('tsk-riverside-cards').completed).toBe(false);
  });
});
