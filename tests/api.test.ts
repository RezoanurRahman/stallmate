import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { MarketStore } from '../src/server/store';
import type { Activity, Market, SetupTask, Vendor } from '../src/server/types';

const buildApp = () => createApp(new MarketStore());

describe('GET /api/health', () => {
  it('reports the service status as JSON', async () => {
    const response = await request(buildApp()).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({ status: 'ok', service: 'stallmate' });
  });
});

describe('GET /api/dashboard', () => {
  it('returns every dashboard section with derived metrics', async () => {
    const response = await request(buildApp()).get('/api/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.markets).toHaveLength(3);
    expect(response.body.vendors).toHaveLength(9);
    expect(response.body.tasks).toHaveLength(10);
    expect(response.body.activity).toHaveLength(11);
    expect(response.body.metrics).toEqual({
      upcomingMarkets: 2,
      totalVendors: 9,
      openTasks: 5,
      readiness: 50,
    });
    expect(response.body.metrics.readiness).toBeGreaterThanOrEqual(0);
    expect(response.body.metrics.readiness).toBeLessThanOrEqual(100);
  });
});

describe('market routes', () => {
  it('lists the seeded markets', async () => {
    const response = await request(buildApp()).get('/api/markets');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);
    expect(response.body.map((market: Market) => market.id)).toEqual(
      expect.arrayContaining(['mkt-lantern-late', 'mkt-makers-riverside', 'mkt-harvest-cedar']),
    );
    expect(
      response.body.every(
        (market: Market) => typeof market.capacity === 'number' && market.capacity > 0,
      ),
    ).toBe(true);
  });

  it('creates markets with defaults and with explicit optional fields', async () => {
    const app = buildApp();

    const minimal = await request(app).post('/api/markets').send({
      name: 'Night Bazaar',
      date: '2026-11-07',
      venue: 'Dockside Shed',
      neighborhood: 'Harbour',
    });
    expect(minimal.status).toBe(201);
    expect(minimal.body).toMatchObject({
      name: 'Night Bazaar',
      status: 'planning',
      capacity: 20,
      notes: '',
      id: expect.stringMatching(/^mkt-/),
    });

    const detailed = await request(app).post('/api/markets').send({
      name: 'Winter Fair',
      date: '2026-11-14',
      venue: 'Old Mill Yard',
      neighborhood: 'Lantern District',
      capacity: 40,
      notes: 'Heated tents.',
      status: 'confirmed',
    });
    expect(detailed.status).toBe(201);
    expect(detailed.body).toMatchObject({
      capacity: 40,
      notes: 'Heated tents.',
      status: 'confirmed',
    });

    const listed = await request(app).get('/api/markets');
    expect(listed.body).toHaveLength(5);
    expect(listed.body.map((market: Market) => market.id)).toContain(minimal.body.id);
  });

  it('rejects market payloads with missing or malformed required fields', async () => {
    const app = buildApp();

    const missingName = await request(app)
      .post('/api/markets')
      .send({ date: '2026-11-07', venue: 'Dockside Shed', neighborhood: 'Harbour' });
    expect(missingName.status).toBe(400);
    expect(missingName.body).toEqual({ error: expect.any(String) });
    expect(missingName.body.error).toMatch(/name/);

    const malformedDate = await request(app).post('/api/markets').send({
      name: 'Bad Date Market',
      date: '07-11-2026',
      venue: 'Dockside Shed',
      neighborhood: 'Harbour',
    });
    expect(malformedDate.status).toBe(400);
    expect(malformedDate.body).toEqual({ error: expect.any(String) });
    expect(malformedDate.body.error).toMatch(/date/);
  });

  it('updates market status and reports invalid or unknown targets', async () => {
    const app = buildApp();

    const updated = await request(app)
      .patch('/api/markets/mkt-harvest-cedar')
      .send({ status: 'live' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: 'mkt-harvest-cedar', status: 'live' });

    const listed = await request(app).get('/api/markets');
    const harvest = listed.body.find((market: Market) => market.id === 'mkt-harvest-cedar');
    expect(harvest.status).toBe('live');

    const invalid = await request(app)
      .patch('/api/markets/mkt-harvest-cedar')
      .send({ status: 'paused' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: expect.any(String) });

    const missing = await request(app).patch('/api/markets/mkt-missing').send({ status: 'live' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String) });
  });
});

describe('vendor routes', () => {
  it('lists all vendors and filters by marketId', async () => {
    const app = buildApp();

    const all = await request(app).get('/api/vendors');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(9);

    const filtered = await request(app)
      .get('/api/vendors')
      .query({ marketId: 'mkt-makers-riverside' });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toHaveLength(4);
    expect(
      filtered.body.every((vendor: Vendor) => vendor.marketId === 'mkt-makers-riverside'),
    ).toBe(true);

    const missing = await request(app).get('/api/vendors').query({ marketId: 'mkt-missing' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String) });
  });

  it('creates a vendor for an existing market and rejects unknown markets', async () => {
    const app = buildApp();
    const payload = {
      marketId: 'mkt-makers-riverside',
      name: 'Copper Kettles',
      category: 'Homeware',
      stall: 'A5',
      contact: 'Rae Cooper · rae@copperkettles.example',
      fee: 25,
      status: 'confirmed',
    };

    const created = await request(app).post('/api/vendors').send(payload);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      ...payload,
      checkedIn: false,
      id: expect.stringMatching(/^vnd-/),
    });

    const filtered = await request(app)
      .get('/api/vendors')
      .query({ marketId: 'mkt-makers-riverside' });
    expect(filtered.body).toHaveLength(5);
    expect(filtered.body.some((vendor: Vendor) => vendor.id === created.body.id)).toBe(true);

    const unknownMarket = await request(app).post('/api/vendors').send({
      marketId: 'mkt-missing',
      name: 'Nomad Goods',
      category: 'Craft',
      stall: 'Z9',
      contact: 'nobody@example.test',
    });
    expect(unknownMarket.status).toBe(404);
    expect(unknownMarket.body).toEqual({ error: expect.any(String) });
  });

  it('rejects vendor payloads that miss required fields', async () => {
    const response = await request(buildApp()).post('/api/vendors').send({
      marketId: 'mkt-makers-riverside',
      name: 'No Stall Vendor',
      category: 'Craft',
      contact: 'nobody@example.test',
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: expect.any(String) });
    expect(response.body.error).toMatch(/stall/);
  });

  it('updates vendor check-in and status, and validates the patch', async () => {
    const app = buildApp();

    const checkedIn = await request(app)
      .patch('/api/vendors/vnd-fern-ink')
      .send({ checkedIn: true });
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body).toMatchObject({
      id: 'vnd-fern-ink',
      checkedIn: true,
      status: 'pending',
    });

    const promoted = await request(app)
      .patch('/api/vendors/vnd-fern-ink')
      .send({ status: 'confirmed', checkedIn: false });
    expect(promoted.status).toBe(200);
    expect(promoted.body).toMatchObject({ status: 'confirmed', checkedIn: false });

    const empty = await request(app).patch('/api/vendors/vnd-fern-ink').send({});
    expect(empty.status).toBe(400);
    expect(empty.body).toEqual({ error: expect.any(String) });

    const invalidStatus = await request(app)
      .patch('/api/vendors/vnd-fern-ink')
      .send({ status: 'expired' });
    expect(invalidStatus.status).toBe(400);
    expect(invalidStatus.body).toEqual({ error: expect.any(String) });

    const missing = await request(app).patch('/api/vendors/vnd-missing').send({ checkedIn: true });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String) });
  });
});

describe('task routes', () => {
  it('lists all tasks and filters by marketId', async () => {
    const app = buildApp();

    const all = await request(app).get('/api/tasks');
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(10);

    const filtered = await request(app).get('/api/tasks').query({ marketId: 'mkt-harvest-cedar' });
    expect(filtered.status).toBe(200);
    expect(filtered.body).toHaveLength(3);
    expect(filtered.body.every((task: SetupTask) => task.marketId === 'mkt-harvest-cedar')).toBe(
      true,
    );

    const missing = await request(app).get('/api/tasks').query({ marketId: 'mkt-missing' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: expect.any(String) });
  });

  it('completes a task and rejects malformed or unknown updates', async () => {
    const app = buildApp();

    const completed = await request(app)
      .patch('/api/tasks/tsk-riverside-cards')
      .send({ completed: true });
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({ id: 'tsk-riverside-cards', completed: true });

    const filtered = await request(app)
      .get('/api/tasks')
      .query({ marketId: 'mkt-makers-riverside' });
    const task = filtered.body.find(
      (candidate: SetupTask) => candidate.id === 'tsk-riverside-cards',
    );
    expect(task.completed).toBe(true);

    const malformed = await request(app)
      .patch('/api/tasks/tsk-riverside-cards')
      .send({ completed: 'yes' });
    expect(malformed.status).toBe(400);

    const missingFlag = await request(app).patch('/api/tasks/tsk-riverside-cards').send({});
    expect(missingFlag.status).toBe(400);

    const unknownTask = await request(app)
      .patch('/api/tasks/tsk-missing')
      .send({ completed: true });
    expect(unknownTask.status).toBe(404);
    expect(unknownTask.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /api/activity', () => {
  it('lists the seeded activity and records later mutations', async () => {
    const app = buildApp();

    const initial = await request(app).get('/api/activity');
    expect(initial.status).toBe(200);
    expect(initial.body).toHaveLength(11);
    expect(
      initial.body.every(
        (entry: Activity) =>
          typeof entry.message === 'string' &&
          typeof entry.timestamp === 'string' &&
          typeof entry.kind === 'string',
      ),
    ).toBe(true);

    await request(app).patch('/api/markets/mkt-harvest-cedar').send({ status: 'confirmed' });

    const after = await request(app).get('/api/activity');
    expect(after.body).toHaveLength(12);
    expect(
      after.body.some(
        (entry: Activity) =>
          entry.kind === 'market' && entry.message.includes('Harvest & Handmade'),
      ),
    ).toBe(true);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 for unrecognised API paths', async () => {
    const response = await request(buildApp()).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Not found' });
  });
});
