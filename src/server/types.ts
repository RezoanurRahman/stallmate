export const MARKET_STATUSES = ['planning', 'confirmed', 'live', 'complete'] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

export const VENDOR_STATUSES = ['confirmed', 'pending', 'waitlist'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const ACTIVITY_KINDS = ['market', 'vendor', 'task', 'system'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface Market {
  id: string;
  name: string;
  /** Calendar date in YYYY-MM-DD form. */
  date: string;
  venue: string;
  neighborhood: string;
  status: MarketStatus;
  capacity: number;
  notes: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface Vendor {
  id: string;
  marketId: string;
  name: string;
  category: string;
  stall: string;
  contact: string;
  fee: number;
  status: VendorStatus;
  checkedIn: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface SetupTask {
  id: string;
  marketId: string;
  title: string;
  area: string;
  dueTime: string;
  assignee: string;
  completed: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface Activity {
  id: string;
  kind: ActivityKind;
  message: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

export interface DashboardMetrics {
  upcomingMarkets: number;
  totalVendors: number;
  openTasks: number;
  readiness: number;
}

export interface Dashboard {
  markets: Market[];
  vendors: Vendor[];
  tasks: SetupTask[];
  activity: Activity[];
  metrics: DashboardMetrics;
}

export interface CreateMarketInput {
  name: string;
  date: string;
  venue: string;
  neighborhood: string;
  capacity?: number | undefined;
  notes?: string | undefined;
  status?: MarketStatus | undefined;
}

export interface CreateVendorInput {
  marketId: string;
  name: string;
  category: string;
  stall: string;
  contact: string;
  fee?: number | undefined;
  status?: VendorStatus | undefined;
}

export interface VendorUpdates {
  status?: VendorStatus | undefined;
  checkedIn?: boolean | undefined;
}

export const isMarketStatus = (value: unknown): value is MarketStatus =>
  typeof value === 'string' && (MARKET_STATUSES as readonly string[]).includes(value);

export const isVendorStatus = (value: unknown): value is VendorStatus =>
  typeof value === 'string' && (VENDOR_STATUSES as readonly string[]).includes(value);

export const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value);
