import {
  MARKET_STATUSES,
  VENDOR_STATUSES,
  isMarketStatus,
  isVendorStatus,
  type Activity,
  type ActivityKind,
  type CreateMarketInput,
  type CreateVendorInput,
  type Dashboard,
  type DashboardMetrics,
  type Market,
  type MarketStatus,
  type SetupTask,
  type Vendor,
  type VendorStatus,
  type VendorUpdates,
} from './types.js';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MARKET_STATUS_RANK: Record<MarketStatus, number> = {
  live: 0,
  confirmed: 1,
  planning: 2,
  complete: 3,
};

const padSequence = (value: number): string => String(value).padStart(3, '0');

const requireText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const optionalText = (value: unknown, field: string, fallback: string): string => {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  return value.trim();
};

const requireDate = (value: unknown): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new ValidationError('date must be a valid YYYY-MM-DD date');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('date must be a valid YYYY-MM-DD date');
  }
  return value;
};

const requireMarketStatus = (value: unknown): MarketStatus => {
  if (!isMarketStatus(value)) {
    throw new ValidationError(
      `Invalid market status: ${String(value)}. Expected one of ${MARKET_STATUSES.join(', ')}`,
    );
  }
  return value;
};

const requireVendorStatus = (value: unknown): VendorStatus => {
  if (!isVendorStatus(value)) {
    throw new ValidationError(
      `Invalid vendor status: ${String(value)}. Expected one of ${VENDOR_STATUSES.join(', ')}`,
    );
  }
  return value;
};

const requireCapacity = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError('capacity must be a positive integer');
  }
  return value;
};

const requireFee = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError('fee must be a non-negative number');
  }
  return value;
};

const requireBoolean = (value: unknown, field: string): boolean => {
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`);
  return value;
};

const seedMarkets = (): Market[] => [
  {
    id: 'mkt-lantern-late',
    name: 'Lantern Late Market',
    date: '2026-09-26',
    venue: 'Old Mill Yard',
    neighborhood: 'Lantern District',
    status: 'complete',
    capacity: 28,
    notes: 'Evening market wrapped after the 21:00 lantern parade.',
    createdAt: '2026-08-29T11:05:00.000Z',
  },
  {
    id: 'mkt-makers-riverside',
    name: 'Saturday Makers Market',
    date: '2026-10-03',
    venue: 'Riverside Hall',
    neighborhood: 'Riverside',
    status: 'confirmed',
    capacity: 32,
    notes: 'Doors open 08:00; stallholders arrive from 07:15.',
    createdAt: '2026-09-12T09:15:00.000Z',
  },
  {
    id: 'mkt-harvest-cedar',
    name: 'Harvest & Handmade',
    date: '2026-10-10',
    venue: 'Cedar Square',
    neighborhood: 'Cedar Park',
    status: 'planning',
    capacity: 24,
    notes: 'Waitlist opens if confirmed vendors exceed capacity.',
    createdAt: '2026-09-18T14:40:00.000Z',
  },
];

const seedVendors = (): Vendor[] => [
  {
    id: 'vnd-tumble-toys',
    marketId: 'mkt-lantern-late',
    name: 'Tumble Toys',
    category: 'Kids',
    stall: 'A2',
    contact: 'Grace Nolan · grace@tumbletoys.example',
    fee: 30,
    status: 'confirmed',
    checkedIn: true,
    createdAt: '2026-09-05T12:00:00.000Z',
  },
  {
    id: 'vnd-spice-route',
    marketId: 'mkt-lantern-late',
    name: 'Spice Route Kitchen',
    category: 'Food',
    stall: 'D3',
    contact: 'Ibrahim Haddad · ibrahim@spiceroute.example',
    fee: 50,
    status: 'confirmed',
    checkedIn: true,
    createdAt: '2026-09-06T10:35:00.000Z',
  },
  {
    id: 'vnd-kettle-corn',
    marketId: 'mkt-makers-riverside',
    name: 'Kettle & Corn',
    category: 'Food',
    stall: 'A1',
    contact: 'Rosa Delgado · rosa@kettlecorn.example',
    fee: 45,
    status: 'confirmed',
    checkedIn: false,
    createdAt: '2026-09-12T10:02:00.000Z',
  },
  {
    id: 'vnd-bramble-bakes',
    marketId: 'mkt-makers-riverside',
    name: 'Bramble Bakes',
    category: 'Bakery',
    stall: 'B2',
    contact: 'Nadia Bekele · nadia@bramblebakes.example',
    fee: 55,
    status: 'confirmed',
    checkedIn: false,
    createdAt: '2026-09-13T08:25:00.000Z',
  },
  {
    id: 'vnd-clay-cove',
    marketId: 'mkt-makers-riverside',
    name: 'Clay Cove Ceramics',
    category: 'Craft',
    stall: 'A4',
    contact: 'Jonah Marsh · jonah@claycove.example',
    fee: 40,
    status: 'confirmed',
    checkedIn: false,
    createdAt: '2026-09-13T16:10:00.000Z',
  },
  {
    id: 'vnd-fern-ink',
    marketId: 'mkt-makers-riverside',
    name: 'Fern & Ink Prints',
    category: 'Art',
    stall: 'C3',
    contact: 'Priya Raman · priya@fernink.example',
    fee: 35,
    status: 'pending',
    checkedIn: false,
    createdAt: '2026-09-20T11:48:00.000Z',
  },
  {
    id: 'vnd-hollow-brew',
    marketId: 'mkt-harvest-cedar',
    name: 'Hollow Brew Coffee',
    category: 'Drinks',
    stall: 'D1',
    contact: 'Tomas Lind · tomas@hollowbrew.example',
    fee: 60,
    status: 'pending',
    checkedIn: false,
    createdAt: '2026-09-21T09:30:00.000Z',
  },
  {
    id: 'vnd-willow-weaves',
    marketId: 'mkt-harvest-cedar',
    name: 'Willow Weaves',
    category: 'Textiles',
    stall: 'B3',
    contact: 'Amara Osei · amara@willowweaves.example',
    fee: 38,
    status: 'confirmed',
    checkedIn: false,
    createdAt: '2026-09-22T14:05:00.000Z',
  },
  {
    id: 'vnd-lumen-glass',
    marketId: 'mkt-harvest-cedar',
    name: 'Lumen Glassworks',
    category: 'Craft',
    stall: 'C2',
    contact: 'Sofia Marchetti · sofia@lumenglass.example',
    fee: 42,
    status: 'waitlist',
    checkedIn: false,
    createdAt: '2026-09-25T17:20:00.000Z',
  },
];

const seedTasks = (): SetupTask[] => [
  {
    id: 'tsk-lantern-signage',
    marketId: 'mkt-lantern-late',
    title: 'Pack down signage',
    area: 'Pack-down',
    dueTime: '20:15',
    assignee: 'Iris Chen',
    completed: true,
    createdAt: '2026-09-22T10:00:00.000Z',
  },
  {
    id: 'tsk-lantern-fees',
    marketId: 'mkt-lantern-late',
    title: 'Reconcile vendor fees',
    area: 'Admin',
    dueTime: '20:45',
    assignee: 'Marta Quinn',
    completed: true,
    createdAt: '2026-09-22T10:05:00.000Z',
  },
  {
    id: 'tsk-riverside-layout',
    marketId: 'mkt-makers-riverside',
    title: 'Confirm stall layout with venue',
    area: 'Floor plan',
    dueTime: '07:45',
    assignee: 'Marta Quinn',
    completed: true,
    createdAt: '2026-09-14T09:00:00.000Z',
  },
  {
    id: 'tsk-riverside-cards',
    marketId: 'mkt-makers-riverside',
    title: 'Print vendor stall cards',
    area: 'Admin',
    dueTime: '09:30',
    assignee: 'Dev Patel',
    completed: false,
    createdAt: '2026-09-15T10:20:00.000Z',
  },
  {
    id: 'tsk-riverside-power',
    marketId: 'mkt-makers-riverside',
    title: 'Test power to food stalls',
    area: 'Utilities',
    dueTime: '15:00',
    assignee: 'Sam Ortega',
    completed: false,
    createdAt: '2026-09-16T13:55:00.000Z',
  },
  {
    id: 'tsk-riverside-banners',
    marketId: 'mkt-makers-riverside',
    title: 'Hang wayfinding banners',
    area: 'Entrance',
    dueTime: '16:30',
    assignee: 'Iris Chen',
    completed: false,
    createdAt: '2026-09-17T08:10:00.000Z',
  },
  {
    id: 'tsk-riverside-welcome',
    marketId: 'mkt-makers-riverside',
    title: 'Pack vendor welcome packs',
    area: 'Admin',
    dueTime: '17:00',
    assignee: 'Dev Patel',
    completed: true,
    createdAt: '2026-09-17T15:40:00.000Z',
  },
  {
    id: 'tsk-cedar-waitlist',
    marketId: 'mkt-harvest-cedar',
    title: 'Send waitlist offers',
    area: 'Admin',
    dueTime: '10:00',
    assignee: 'Marta Quinn',
    completed: false,
    createdAt: '2026-09-19T09:05:00.000Z',
  },
  {
    id: 'tsk-cedar-grid',
    marketId: 'mkt-harvest-cedar',
    title: 'Measure square for stall grid',
    area: 'Floor plan',
    dueTime: '11:15',
    assignee: 'Sam Ortega',
    completed: true,
    createdAt: '2026-09-19T14:30:00.000Z',
  },
  {
    id: 'tsk-cedar-generator',
    marketId: 'mkt-harvest-cedar',
    title: 'Book generator for stage',
    area: 'Utilities',
    dueTime: '14:00',
    assignee: 'Dev Patel',
    completed: false,
    createdAt: '2026-09-23T11:25:00.000Z',
  },
];

const seedActivity = (): Activity[] => [
  {
    id: 'act-001',
    kind: 'market',
    message: 'Lantern Late Market scheduled for 26 September at Old Mill Yard',
    timestamp: '2026-09-05T09:12:00.000Z',
  },
  {
    id: 'act-002',
    kind: 'vendor',
    message: 'Spice Route Kitchen confirmed for Lantern Late Market (stall D3)',
    timestamp: '2026-09-06T10:40:00.000Z',
  },
  {
    id: 'act-003',
    kind: 'market',
    message: 'Saturday Makers Market confirmed for Riverside Hall on 3 October',
    timestamp: '2026-09-12T09:20:00.000Z',
  },
  {
    id: 'act-004',
    kind: 'vendor',
    message: 'Bramble Bakes added to Saturday Makers Market (stall B2)',
    timestamp: '2026-09-13T08:30:00.000Z',
  },
  {
    id: 'act-005',
    kind: 'task',
    message: 'Task "Confirm stall layout with venue" marked complete',
    timestamp: '2026-09-14T17:05:00.000Z',
  },
  {
    id: 'act-006',
    kind: 'task',
    message: 'Task "Send waitlist offers" opened for Harvest & Handmade',
    timestamp: '2026-09-19T09:12:00.000Z',
  },
  {
    id: 'act-007',
    kind: 'task',
    message: 'Task "Measure square for stall grid" marked complete',
    timestamp: '2026-09-19T16:00:00.000Z',
  },
  {
    id: 'act-008',
    kind: 'vendor',
    message: 'Lumen Glassworks added to the Harvest & Handmade waitlist (stall C2)',
    timestamp: '2026-09-25T17:25:00.000Z',
  },
  {
    id: 'act-009',
    kind: 'market',
    message: 'Lantern Late Market marked complete after pack-down',
    timestamp: '2026-09-26T21:30:00.000Z',
  },
  {
    id: 'act-010',
    kind: 'system',
    message: 'Weekend readiness digest generated for 1 October',
    timestamp: '2026-10-01T07:00:00.000Z',
  },
  {
    id: 'act-011',
    kind: 'vendor',
    message: 'Fern & Ink Prints still pending stall fee for Saturday Makers Market',
    timestamp: '2026-10-01T08:15:00.000Z',
  },
];

export class MarketStore {
  private readonly markets: Market[] = [];
  private readonly vendors: Vendor[] = [];
  private readonly tasks: SetupTask[] = [];
  private readonly activity: Activity[] = [];

  private marketSequence = 0;
  private vendorSequence = 0;
  private activitySequence = 0;

  constructor() {
    this.markets.push(...seedMarkets());
    this.vendors.push(...seedVendors());
    this.tasks.push(...seedTasks());
    this.activity.push(...seedActivity());

    this.marketSequence = this.markets.length;
    this.vendorSequence = this.vendors.length;
    this.activitySequence = this.activity.length;
  }

  listMarkets(): Market[] {
    return this.sortedMarkets().map((market) => ({ ...market }));
  }

  getMarket(id: string): Market {
    return { ...this.requireMarket(id) };
  }

  createMarket(input: CreateMarketInput): Market {
    const name = requireText(input?.name, 'name');
    const date = requireDate(input?.date);
    const venue = requireText(input?.venue, 'venue');
    const neighborhood = requireText(input?.neighborhood, 'neighborhood');
    const capacity = requireCapacity(input?.capacity ?? 20);
    const notes = optionalText(input?.notes, 'notes', '');
    const status = requireMarketStatus(input?.status ?? 'planning');

    const duplicate = this.markets.find(
      (market) => market.date === date && market.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new ValidationError(`A market named "${name}" already exists on ${date}`);
    }

    const market: Market = {
      id: `mkt-${padSequence(++this.marketSequence)}`,
      name,
      date,
      venue,
      neighborhood,
      status,
      capacity,
      notes,
      createdAt: this.now(),
    };
    this.markets.push(market);
    this.recordActivity(
      'market',
      `Market "${market.name}" created for ${market.date} at ${market.venue}`,
    );

    return { ...market };
  }

  updateMarketStatus(id: string, status: MarketStatus): Market {
    const market = this.requireMarket(id);
    const nextStatus = requireMarketStatus(status);
    const previousStatus = market.status;
    market.status = nextStatus;

    this.recordActivity(
      'market',
      previousStatus === nextStatus
        ? `Market "${market.name}" status confirmed as ${nextStatus}`
        : `Market "${market.name}" status changed from ${previousStatus} to ${nextStatus}`,
    );

    return { ...market };
  }

  listVendors(marketId?: string): Vendor[] {
    let vendors = this.vendors;
    if (marketId !== undefined) {
      this.requireMarket(marketId);
      vendors = vendors.filter((vendor) => vendor.marketId === marketId);
    }
    return this.sortedVendors(vendors).map((vendor) => ({ ...vendor }));
  }

  getVendor(id: string): Vendor {
    return { ...this.requireVendor(id) };
  }

  createVendor(input: CreateVendorInput): Vendor {
    const marketId = requireText(input?.marketId, 'marketId');
    const market = this.requireMarket(marketId, 'Cannot add vendor: market');
    const name = requireText(input?.name, 'name');
    const category = requireText(input?.category, 'category');
    const stall = requireText(input?.stall, 'stall');
    const contact = requireText(input?.contact, 'contact');
    const fee = requireFee(input?.fee ?? 0);
    const status = requireVendorStatus(input?.status ?? 'pending');

    const conflicting = this.vendors.find(
      (vendor) =>
        vendor.marketId === market.id && vendor.stall.toLowerCase() === stall.toLowerCase(),
    );
    if (conflicting) {
      throw new ValidationError(
        `Stall "${stall}" is already assigned to ${conflicting.name} at ${market.name}`,
      );
    }

    const vendor: Vendor = {
      id: `vnd-${padSequence(++this.vendorSequence)}`,
      marketId: market.id,
      name,
      category,
      stall,
      contact,
      fee,
      status,
      checkedIn: false,
      createdAt: this.now(),
    };
    this.vendors.push(vendor);
    this.recordActivity(
      'vendor',
      `Vendor "${vendor.name}" added to ${market.name} (stall ${vendor.stall})`,
    );

    return { ...vendor };
  }

  updateVendor(id: string, updates: VendorUpdates): Vendor {
    const vendor = this.requireVendor(id);
    const nextStatus =
      updates?.status === undefined ? undefined : requireVendorStatus(updates.status);
    const nextCheckedIn =
      updates?.checkedIn === undefined ? undefined : requireBoolean(updates.checkedIn, 'checkedIn');

    if (nextStatus === undefined && nextCheckedIn === undefined) {
      throw new ValidationError('Provide at least one of status or checkedIn');
    }

    const market = this.requireMarket(vendor.marketId);
    const changes: string[] = [];

    if (nextStatus !== undefined && nextStatus !== vendor.status) {
      changes.push(`status ${vendor.status} -> ${nextStatus}`);
      vendor.status = nextStatus;
    }
    if (nextCheckedIn !== undefined && nextCheckedIn !== vendor.checkedIn) {
      changes.push(nextCheckedIn ? 'checked in' : 'checked out');
      vendor.checkedIn = nextCheckedIn;
    }

    const detail = changes.length > 0 ? changes.join(', ') : 'no changes recorded';
    this.recordActivity('vendor', `Vendor "${vendor.name}" updated at ${market.name} (${detail})`);

    return { ...vendor };
  }

  listTasks(marketId?: string): SetupTask[] {
    let tasks = this.tasks;
    if (marketId !== undefined) {
      this.requireMarket(marketId);
      tasks = tasks.filter((task) => task.marketId === marketId);
    }
    return this.sortedTasks(tasks).map((task) => ({ ...task }));
  }

  getTask(id: string): SetupTask {
    return { ...this.requireTask(id) };
  }

  updateTaskCompletion(id: string, completed: boolean): SetupTask {
    const task = this.requireTask(id);
    const nextCompleted = requireBoolean(completed, 'completed');
    task.completed = nextCompleted;

    this.recordActivity(
      'task',
      nextCompleted ? `Task "${task.title}" marked complete` : `Task "${task.title}" reopened`,
    );

    return { ...task };
  }

  listActivity(): Activity[] {
    return this.activity
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .map((entry) => ({ ...entry }));
  }

  dashboard(): Dashboard {
    const tasks = this.listTasks();
    const completedTasks = tasks.filter((task) => task.completed).length;
    const metrics: DashboardMetrics = {
      upcomingMarkets: this.markets.filter((market) => market.status !== 'complete').length,
      totalVendors: this.vendors.length,
      openTasks: tasks.length - completedTasks,
      readiness: tasks.length === 0 ? 0 : Math.round((completedTasks / tasks.length) * 100),
    };

    return {
      markets: this.listMarkets(),
      vendors: this.listVendors(),
      tasks,
      activity: this.listActivity(),
      metrics,
    };
  }

  private requireMarket(id: string, context = 'Market'): Market {
    const market = this.markets.find((candidate) => candidate.id === id);
    if (!market) throw new NotFoundError(`${context} not found: ${id}`);
    return market;
  }

  private requireVendor(id: string): Vendor {
    const vendor = this.vendors.find((candidate) => candidate.id === id);
    if (!vendor) throw new NotFoundError(`Vendor not found: ${id}`);
    return vendor;
  }

  private requireTask(id: string): SetupTask {
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (!task) throw new NotFoundError(`Task not found: ${id}`);
    return task;
  }

  private recordActivity(kind: ActivityKind, message: string): Activity {
    const entry: Activity = {
      id: `act-${padSequence(++this.activitySequence)}`,
      kind,
      message,
      timestamp: this.now(),
    };
    this.activity.unshift(entry);
    return { ...entry };
  }

  private sortedMarkets(): Market[] {
    return this.markets.slice().sort((a, b) => {
      const rankDelta = MARKET_STATUS_RANK[a.status] - MARKET_STATUS_RANK[b.status];
      if (rankDelta !== 0) return rankDelta;
      const dateDelta =
        a.status === 'complete' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      return dateDelta !== 0 ? dateDelta : a.id.localeCompare(b.id);
    });
  }

  private sortedVendors(vendors: readonly Vendor[]): Vendor[] {
    const marketDate = new Map(this.markets.map((market) => [market.id, market.date]));
    return vendors.slice().sort((a, b) => {
      const dateDelta = (marketDate.get(a.marketId) ?? '').localeCompare(
        marketDate.get(b.marketId) ?? '',
      );
      if (dateDelta !== 0) return dateDelta;
      const stallDelta = a.stall.localeCompare(b.stall);
      return stallDelta !== 0 ? stallDelta : a.id.localeCompare(b.id);
    });
  }

  private sortedTasks(tasks: readonly SetupTask[]): SetupTask[] {
    const marketDate = new Map(this.markets.map((market) => [market.id, market.date]));
    return tasks.slice().sort((a, b) => {
      const dateDelta = (marketDate.get(a.marketId) ?? '').localeCompare(
        marketDate.get(b.marketId) ?? '',
      );
      if (dateDelta !== 0) return dateDelta;
      const timeDelta = a.dueTime.localeCompare(b.dueTime);
      return timeDelta !== 0 ? timeDelta : a.id.localeCompare(b.id);
    });
  }

  private now(): string {
    return new Date().toISOString();
  }
}
