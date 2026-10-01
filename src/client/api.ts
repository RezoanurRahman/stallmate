/**
 * Stallmate browser API client.
 *
 * The Express server exposes these routes (mirrored by the functions below):
 *
 *   GET    /api/dashboard              -> Dashboard
 *   POST   /api/markets                -> Market
 *   PATCH  /api/markets/:id            -> Market      body: { status }
 *   POST   /api/vendors                -> Vendor
 *   PATCH  /api/vendors/:id            -> Vendor      body: partial vendor fields
 *   PATCH  /api/tasks/:id              -> SetupTask   body: { completed }
 *
 * The interfaces are declared locally so the client never imports server code.
 * Every failure is normalised into a plain `Error` with a message that can be
 * shown directly in the UI.
 */

export type MarketStatus = "planning" | "confirmed" | "live" | "complete";
export type VendorStatus = "confirmed" | "pending" | "waitlist";

export interface Market {
  id: string;
  name: string;
  date: string;
  venue: string;
  neighborhood: string;
  status: MarketStatus;
  capacity: number;
  notes: string;
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
  createdAt: string;
}

export interface Activity {
  id: string;
  kind: string;
  message: string;
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

export interface NewMarketInput {
  name: string;
  date: string;
  venue: string;
  neighborhood: string;
  capacity?: number;
  notes?: string;
}

export interface NewVendorInput {
  marketId: string;
  name: string;
  category?: string;
  stall?: string;
  contact?: string;
  fee?: number;
  status?: VendorStatus;
}

export type VendorUpdateInput = Partial<
  Pick<
    Vendor,
    "marketId" | "name" | "category" | "stall" | "contact" | "fee" | "status" | "checkedIn"
  >
>;

/** Base path of the Express API. The Vite dev server proxies this to the API. */
export const API_BASE = "/api";

const REQUEST_TIMEOUT_MS = 12_000;

type HttpMethod = "GET" | "POST" | "PATCH";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
}

interface TaggedError extends Error {
  status?: number;
}

function toError(value: unknown, fallback: string): Error {
  if (value instanceof Error && value.message) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error(fallback);
}

function tagStatus(error: Error, status: number | undefined): Error {
  (error as TaggedError).status = status;
  return error;
}

function statusOf(error: unknown): number | undefined {
  return error instanceof Error ? (error as TaggedError).status : undefined;
}

async function describeHttpError(response: Response, context: string): Promise<string> {
  let detail = "";
  try {
    const raw = (await response.text()).trim();
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "string") {
          detail = parsed;
        } else if (parsed && typeof parsed === "object") {
          const record = parsed as Record<string, unknown>;
          const candidate = record.error ?? record.message;
          if (typeof candidate === "string") detail = candidate;
        }
      } catch {
        detail = raw;
      }
    }
  } catch {
    /* The body could not be read; fall back to the status line. */
  }

  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
  return detail
    ? `${context} failed (${status}): ${detail}`
    : `${context} failed with HTTP ${status}.`;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  context = "Request",
): Promise<T> {
  const method = options.method ?? "GET";
  const hasBody = options.body !== undefined;
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer =
    controller === null ? null : window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: hasBody
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: controller ? controller.signal : undefined,
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw tagStatus(
        new Error(
          `${context} timed out after ${REQUEST_TIMEOUT_MS / 1000}s. The Stallmate API did not respond.`,
        ),
        undefined,
      );
    }
    const reason = error instanceof Error && error.message ? ` (${error.message})` : "";
    throw tagStatus(
      new Error(`${context} failed: could not reach the Stallmate API${reason}.`),
      undefined,
    );
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }

  if (!response.ok) {
    throw tagStatus(new Error(await describeHttpError(response, context)), response.status);
  }

  const raw = await response.text();
  if (!raw.trim()) return undefined as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw tagStatus(new Error(`${context} failed: the API returned invalid JSON.`), response.status);
  }
}

/**
 * Retries the same request on a second path when the first one is missing.
 * Used for `/tasks` vs `/setup-tasks`, the only route name that is not
 * unambiguous in the shared contract.
 */
async function requestWithFallback<T>(
  paths: readonly string[],
  options: RequestOptions,
  context: string,
): Promise<T> {
  let lastError: Error | null = null;
  for (const path of paths) {
    try {
      return await request<T>(path, options, context);
    } catch (error) {
      lastError = toError(error, `${context} failed.`);
      if (statusOf(error) !== 404) throw lastError;
    }
  }
  throw lastError ?? new Error(`${context} failed.`);
}

/**
 * Unwraps `{ market: {...} }` style envelopes when the server uses one.
 * A body that already carries its own `id` is returned untouched.
 */
function extractEntity<T>(body: unknown, keys: readonly string[]): T {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body as T;
  const record = body as Record<string, unknown>;
  if (typeof record.id === "string") return body as T;
  for (const key of keys) {
    const value = record[key];
    if (value !== null && typeof value === "object") return value as T;
  }
  return body as T;
}

/** Loads the whole operations desk in a single request. */
export async function fetchDashboard(): Promise<Dashboard> {
  const body = await request<unknown>("/dashboard", { method: "GET" }, "Dashboard load");
  return extractEntity<Dashboard>(body, ["dashboard", "data"]);
}

export async function createMarket(input: NewMarketInput): Promise<Market> {
  const body = await request<unknown>("/markets", { method: "POST", body: input }, "Market creation");
  return extractEntity<Market>(body, ["market", "data"]);
}

export async function updateMarket(id: string, status: MarketStatus): Promise<Market> {
  const body = await request<unknown>(
    `/markets/${encodeURIComponent(id)}`,
    { method: "PATCH", body: { status } },
    "Market update",
  );
  return extractEntity<Market>(body, ["market", "data"]);
}

export async function createVendor(input: NewVendorInput): Promise<Vendor> {
  const body = await request<unknown>("/vendors", { method: "POST", body: input }, "Vendor creation");
  return extractEntity<Vendor>(body, ["vendor", "data"]);
}

export async function updateVendor(id: string, input: VendorUpdateInput): Promise<Vendor> {
  const body = await request<unknown>(
    `/vendors/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
    "Vendor update",
  );
  return extractEntity<Vendor>(body, ["vendor", "data"]);
}

export async function updateTask(id: string, completed: boolean): Promise<SetupTask> {
  const body = await requestWithFallback<unknown>(
    [`/tasks/${encodeURIComponent(id)}`, `/setup-tasks/${encodeURIComponent(id)}`],
    { method: "PATCH", body: { completed } },
    "Setup task update",
  );
  return extractEntity<SetupTask>(body, ["task", "data"]);
}
