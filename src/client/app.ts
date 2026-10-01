/**
 * Stallmate — Hyperapp 2 operations dashboard.
 *
 * `bootstrapApp()` is the single entry point used by `main.ts`. The module owns
 * three small ideas:
 *
 *   1. one typed `State` object, one `actions` table;
 *   2. request effects that keep every network call out of the reducers;
 *   3. a view built only from `h()` / `text()` so Hyperapp owns the DOM.
 *
 * Every mutation re-fetches the dashboard instead of patching nested entities
 * locally, so the UI always shows what the API actually stored.
 */

import {
  app,
  h,
  text,
  type Action,
  type Dispatch,
  type Dispatchable,
  type Effect,
  type Effecter,
  type VNode,
} from "hyperapp";

import {
  createMarket,
  createVendor,
  fetchDashboard,
  updateMarket,
  updateTask,
  updateVendor,
  type Activity,
  type Dashboard,
  type Market,
  type MarketStatus,
  type NewMarketInput,
  type NewVendorInput,
  type SetupTask,
  type Vendor,
  type VendorStatus,
} from "./api";

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export type DashboardView = "overview" | "vendors" | "setup";
export type VendorFilter = VendorStatus | "all";

interface Notice {
  id: number;
  message: string;
}

export interface State {
  dashboard: Dashboard | null;
  loading: boolean;
  loadedAt: string | null;
  error: string | null;
  mutationError: string | null;
  notice: Notice | null;
  view: DashboardView;
  selectedMarketId: string | null;
  vendorQuery: string;
  vendorFilter: VendorFilter;
  vendorFormOpen: boolean;
  vendorFormKey: number;
  newMarketOpen: boolean;
  /** Key of the request in flight, e.g. `status:mkt_1`, `task:tsk_2`, `refresh`. */
  pending: string | null;
}

export const initialState: State = {
  dashboard: null,
  loading: true,
  loadedAt: null,
  error: null,
  mutationError: null,
  notice: null,
  view: "overview",
  selectedMarketId: null,
  vendorQuery: "",
  vendorFilter: "all",
  vendorFormOpen: false,
  vendorFormKey: 0,
  newMarketOpen: false,
  pending: "refresh",
};

const NOTICE_MS = 7_000;

let noticeSequence = 0;

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const VIEW_TABS: ReadonlyArray<{ id: DashboardView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "vendors", label: "Vendors" },
  { id: "setup", label: "Setup" },
];

const MARKET_STATUS_ORDER: readonly MarketStatus[] = [
  "planning",
  "confirmed",
  "live",
  "complete",
];

const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  planning: "Planning",
  confirmed: "Confirmed",
  live: "Live",
  complete: "Complete",
};

const MARKET_STATUS_HINT: Record<MarketStatus, string> = {
  planning: "Still drafting the plan",
  confirmed: "Date and venue locked",
  live: "Doors are open",
  complete: "Market wrapped up",
};

const VENDOR_STATUS_ORDER: readonly VendorStatus[] = ["confirmed", "pending", "waitlist"];

const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  waitlist: "Waitlist",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/* -------------------------------------------------------------------------- */
/* Formatting helpers (locale-independent on purpose)                         */
/* -------------------------------------------------------------------------- */

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "Sat 3 Oct 2026" — UTC getters keep date-only strings stable everywhere. */
export function formatMarketDate(value: string): string {
  const date = parseDate(value);
  if (!date) return value ? value : "Date to confirm";
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "14:03" from an ISO timestamp, in the visitor's own timezone. */
export function formatClock(value: string | null): string {
  const date = parseDate(value);
  if (!date) return "--:--";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "8:30 AM" for "08:30"; falls back to a plain time or the raw value. */
export function formatDueTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 24 && minutes < 60) {
      const suffix = hours >= 12 ? "PM" : "AM";
      const hour12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${hour12}:${pad(minutes)} ${suffix}`;
    }
  }
  const date = parseDate(value);
  if (date) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return value || "Time TBC";
}

function formatRelativeTime(value: string, now: number): string {
  const date = parseDate(value);
  if (!date) return value || "just now";
  const minutes = Math.round((now - date.getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return formatMarketDate(value);
}

export function formatFee(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function plural(count: number, singular: string, pluralWord = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function compareByDueTime(a: SetupTask, b: SetupTask): number {
  const left = a.dueTime || "zzzz";
  const right = b.dueTime || "zzzz";
  if (left === right) return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  return left < right ? -1 : 1;
}

function activityTone(kind: string): "accent" | "info" | "warn" | "ok" {
  const value = (kind || "").toLowerCase();
  if (value.includes("vendor")) return "info";
  if (value.includes("task") || value.includes("setup")) return "warn";
  if (value.includes("market") || value.includes("status")) return "accent";
  return "ok";
}

function activityLabel(kind: string): string {
  const value = (kind || "update").replace(/[_-]+/g, " ").trim();
  if (!value) return "Update";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/* -------------------------------------------------------------------------- */
/* Selectors                                                                  */
/* -------------------------------------------------------------------------- */

function selectedMarket(state: State): Market | null {
  const dashboard = state.dashboard;
  if (!dashboard || dashboard.markets.length === 0) return null;
  const found = dashboard.markets.find((market) => market.id === state.selectedMarketId);
  return found ?? dashboard.markets[0];
}

function pickMarketId(current: string | null, dashboard: Dashboard): string | null {
  if (dashboard.markets.length === 0) return null;
  if (current && dashboard.markets.some((market) => market.id === current)) return current;
  return dashboard.markets[0].id;
}

function vendorsForMarket(state: State, marketId: string | null): Vendor[] {
  const vendors = state.dashboard?.vendors ?? [];
  if (!marketId) return vendors;
  return vendors.filter((vendor) => vendor.marketId === marketId);
}

function tasksForMarket(state: State, marketId: string | null): SetupTask[] {
  const tasks = state.dashboard?.tasks ?? [];
  if (!marketId) return tasks;
  return tasks.filter((task) => task.marketId === marketId);
}

function visibleVendors(state: State, vendors: Vendor[]): Vendor[] {
  const query = state.vendorQuery.trim().toLowerCase();
  return vendors.filter((vendor) => {
    if (state.vendorFilter !== "all" && vendor.status !== state.vendorFilter) return false;
    if (!query) return true;
    const haystack = [vendor.name, vendor.category, vendor.stall, vendor.contact]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function groupTasksByArea(tasks: SetupTask[]): Array<{ area: string; tasks: SetupTask[] }> {
  const groups = new Map<string, SetupTask[]>();
  for (const task of [...tasks].sort(compareByDueTime)) {
    const area = task.area?.trim() || "General";
    const bucket = groups.get(area);
    if (bucket) bucket.push(task);
    else groups.set(area, [task]);
  }
  return [...groups.entries()].map(([area, groupTasks]) => ({ area, tasks: groupTasks }));
}

function progressOf(tasks: SetupTask[]): { done: number; total: number; percent: number } {
  const total = tasks.length;
  const done = tasks.filter((task) => task.completed).length;
  return { done, total, percent: total === 0 ? 0 : clampPercent((done / total) * 100) };
}

interface BriefItem {
  id: string;
  text: string;
  hint: string;
  tone: "warn" | "info" | "ok";
  view: DashboardView | null;
  action: string;
}

function buildBrief(
  state: State,
  market: Market | null,
  marketVendors: Vendor[],
  marketTasks: SetupTask[],
): BriefItem[] {
  if (!state.dashboard) {
    return [
      {
        id: "offline",
        text: "Reconnect to the operations desk",
        hint: state.error ?? "The dashboard has not loaded yet.",
        tone: "warn",
        view: null,
        action: "",
      },
    ];
  }

  if (!market) {
    return [
      {
        id: "no-market",
        text: "Create your first market",
        hint: "Markets hold vendors, setup tasks, and readiness in one place.",
        tone: "warn",
        view: null,
        action: "",
      },
    ];
  }

  const items: BriefItem[] = [];
  const openTasks = marketTasks.filter((task) => !task.completed).sort(compareByDueTime);

  for (const task of openTasks.slice(0, 2)) {
    const details = [
      `Due ${formatDueTime(task.dueTime)}`,
      task.assignee || null,
      task.area || null,
    ].filter((part): part is string => Boolean(part));
    items.push({
      id: `task-${task.id}`,
      text: task.title,
      hint: details.join(" · "),
      tone: "warn",
      view: "setup",
      action: "Open setup",
    });
  }

  const pending = marketVendors.filter((vendor) => vendor.status === "pending").length;
  if (pending > 0) {
    items.push({
      id: "pending-vendors",
      text: `Confirm ${plural(pending, "pending vendor")}`,
      hint: "Pending vendors stay off the readiness count until confirmed.",
      tone: "info",
      view: "vendors",
      action: "Review roster",
    });
  }

  const waitlisted = marketVendors.filter((vendor) => vendor.status === "waitlist").length;
  if (waitlisted > 0) {
    items.push({
      id: "waitlist",
      text: `${plural(waitlisted, "vendor")} on the waitlist`,
      hint:
        market.capacity > 0
          ? "Promote a waitlisted vendor when a stall frees up."
          : "Set a stall capacity so waitlist promotions have a target.",
      tone: "info",
      view: "vendors",
      action: "Review roster",
    });
  }

  if (market.status === "planning") {
    items.push({
      id: "status-planning",
      text: "Move this market to confirmed",
      hint: "Locking the date lets you confirm vendors with confidence.",
      tone: "warn",
      view: null,
      action: "",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "clear",
      text: "Everything is on track",
      hint: "No open setup tasks or pending vendors for this market.",
      tone: "ok",
      view: null,
      action: "",
    });
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* Effects                                                                    */
/* -------------------------------------------------------------------------- */

interface RequestEffectProps<T> {
  run: () => Promise<T>;
  onSuccess: Action<State, T>;
  onFailure: Action<State, Error>;
}

const requestEffecter: Effecter<State, RequestEffectProps<unknown>> = (dispatch, props) => {
  props.run().then(
    (value) => dispatch(props.onSuccess, value),
    (error) => dispatch(props.onFailure, error instanceof Error ? error : new Error(String(error))),
  );
};

function requestEffect<T>(props: RequestEffectProps<T>): Effect<State, RequestEffectProps<T>> {
  return [
    requestEffecter as unknown as Effecter<State, RequestEffectProps<T>>,
    props,
  ];
}

const scheduleFrame =
  typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (callback: () => void) => window.setTimeout(callback, 0);

const focusEffecter: Effecter<State, string> = (_dispatch, elementId) => {
  scheduleFrame(() => {
    const element = document.getElementById(elementId);
    if (element instanceof HTMLElement) element.focus();
  });
};

function focusEffect(elementId: string): Effect<State, string> {
  return [focusEffecter, elementId];
}

const noticeTimeoutEffecter: Effecter<State, number> = (dispatch, noticeId) => {
  window.setTimeout(() => {
    dispatch(actions.dismissNotice, noticeId);
  }, NOTICE_MS);
};

function noticeTimeoutEffect(noticeId: number): Effect<State, number> {
  return [noticeTimeoutEffecter, noticeId];
}

function loadEffect(): Effect<State, RequestEffectProps<Dashboard>> {
  return requestEffect<Dashboard>({
    run: fetchDashboard,
    onSuccess: actions.dashboardLoaded,
    onFailure: actions.dashboardFailed,
  });
}

/** Re-fetch after a mutation: refresh keeps the current snapshot on screen. */
function refreshEffect(): Effect<State, RequestEffectProps<Dashboard>> {
  return requestEffect<Dashboard>({
    run: fetchDashboard,
    onSuccess: actions.dashboardLoaded,
    onFailure: actions.dashboardFailed,
  });
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

type Handler<Payload> = Action<State, Payload>;

interface Actions {
  setView: Handler<DashboardView>;
  selectMarket: Handler<Event>;
  setVendorQuery: Handler<Event>;
  setVendorFilter: Handler<VendorFilter>;
  clearVendorFilters: (state: State) => State;
  toggleVendorForm: (state: State) => Dispatchable<State>;
  openNewMarket: (state: State) => Dispatchable<State>;
  closeNewMarket: (state: State) => State;
  closeNewMarketFromBackdrop: Handler<MouseEvent>;
  closeNewMarketFromKey: Handler<KeyboardEvent>;
  refresh: (state: State) => Dispatchable<State>;
  dismissNotice: (state: State) => State;
  dismissError: (state: State) => State;
  dismissMutationError: (state: State) => State;
  setMarketStatus: Handler<{ id: string; status: MarketStatus }>;
  toggleVendorCheckIn: Handler<string>;
  toggleTask: Handler<string>;
  submitNewMarket: Handler<Event>;
  submitNewVendor: Handler<Event>;
  dashboardLoaded: Handler<Dashboard>;
  dashboardFailed: Handler<Error>;
  mutationFailed: Handler<Error>;
}

function readText(entry: FormDataEntryValue | null | undefined): string {
  return typeof entry === "string" ? entry.trim() : "";
}

function readNumber(entry: FormDataEntryValue | null | undefined): number | undefined {
  const value = readText(entry);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findVendor(state: State, vendorId: string): Vendor | null {
  return state.dashboard?.vendors.find((vendor) => vendor.id === vendorId) ?? null;
}

function findTask(state: State, taskId: string): SetupTask | null {
  return state.dashboard?.tasks.find((task) => task.id === taskId) ?? null;
}

/**
 * Shared mutation success path: show a dismissible notice, mark the refresh as
 * in flight, then re-fetch the dashboard.
 */
function mutated(state: State, message: string, patch: Partial<State> = {}): Dispatchable<State> {
  const notice: Notice = { id: (noticeSequence += 1), message };
  return [
    { ...state, ...patch, pending: "refresh", mutationError: null, notice },
    refreshEffect(),
    noticeTimeoutEffect(notice.id),
  ];
}

const actions: Actions = {
  setView: (state, view) => ({ ...state, view }),

  selectMarket: (state, event) => {
    const select = event.currentTarget as HTMLSelectElement | null;
    const value = select?.value ?? "";
    return value ? { ...state, selectedMarketId: value } : state;
  },

  setVendorQuery: (state, event) => {
    const input = event.currentTarget as HTMLInputElement | null;
    return { ...state, vendorQuery: input?.value ?? "" };
  },

  setVendorFilter: (state, vendorFilter) => ({ ...state, vendorFilter }),

  clearVendorFilters: (state) => ({ ...state, vendorQuery: "", vendorFilter: "all" }),

  toggleVendorForm: (state) => {
    if (state.vendorFormOpen) return { ...state, vendorFormOpen: false };
    return [
      { ...state, vendorFormOpen: true, mutationError: null },
      focusEffect("vendor-name"),
    ];
  },

  openNewMarket: (state) => [
    { ...state, newMarketOpen: true, mutationError: null },
    focusEffect("new-market-name"),
  ],

  closeNewMarket: (state) => ({ ...state, newMarketOpen: false, mutationError: null }),

  closeNewMarketFromBackdrop: (state, event) =>
    event.target === event.currentTarget ? actions.closeNewMarket(state) : state,

  closeNewMarketFromKey: (state, event) =>
    event.key === "Escape" ? actions.closeNewMarket(state) : state,

  refresh: (state) => [{ ...state, pending: "refresh", error: null }, loadEffect()],

  dismissNotice: (state) => ({ ...state, notice: null }),

  dismissError: (state) => ({ ...state, error: null }),

  dismissMutationError: (state) => ({ ...state, mutationError: null }),

  setMarketStatus: (state, { id, status }) => [
    { ...state, pending: `status:${id}`, mutationError: null },
    requestEffect<Market>({
      run: () => updateMarket(id, status),
      onSuccess: (current, updated) => {
        const name =
          updated && typeof updated.name === "string" && updated.name
            ? updated.name
            : current.dashboard?.markets.find((market) => market.id === id)?.name ?? "Market";
        return mutated(current, `${name} is now ${MARKET_STATUS_LABEL[status].toLowerCase()}.`);
      },
      onFailure: actions.mutationFailed,
    }),
  ],

  toggleVendorCheckIn: (state, vendorId) => {
    const vendor = findVendor(state, vendorId);
    if (!vendor) return state;
    const nextCheckedIn = !vendor.checkedIn;
    return [
      { ...state, pending: `vendor:${vendorId}`, mutationError: null },
      requestEffect<Vendor>({
        run: () => updateVendor(vendorId, { checkedIn: nextCheckedIn }),
        onSuccess: (current, updated) => {
          const name =
            updated && typeof updated.name === "string" && updated.name ? updated.name : vendor.name;
          return mutated(
            current,
            nextCheckedIn ? `${name} is checked in.` : `${name} is checked out.`,
          );
        },
        onFailure: actions.mutationFailed,
      }),
    ];
  },

  toggleTask: (state, taskId) => {
    const task = findTask(state, taskId);
    if (!task) return state;
    const nextCompleted = !task.completed;
    return [
      { ...state, pending: `task:${taskId}`, mutationError: null },
      requestEffect<SetupTask>({
        run: () => updateTask(taskId, nextCompleted),
        onSuccess: (current) =>
          mutated(current, nextCompleted ? `“${task.title}” checked off.` : `“${task.title}” reopened.`),
        onFailure: actions.mutationFailed,
      }),
    ];
  },

  submitNewMarket: (state, event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement | null;
    if (!form) return state;

    const data = new FormData(form);
    const name = readText(data.get("name"));
    const date = readText(data.get("date"));
    const venue = readText(data.get("venue"));
    const neighborhood = readText(data.get("neighborhood"));

    if (!name || !date || !venue || !neighborhood) {
      return {
        ...state,
        mutationError: "Please fill in the market name, date, venue, and neighborhood.",
      };
    }

    const capacity = readNumber(data.get("capacity"));
    const notes = readText(data.get("notes"));
    const input: NewMarketInput = {
      name,
      date,
      venue,
      neighborhood,
      ...(capacity !== undefined ? { capacity } : {}),
      ...(notes ? { notes } : {}),
    };

    return [
      { ...state, pending: "form:market", mutationError: null },
      requestEffect<Market>({
        run: () => createMarket(input),
        onSuccess: (current, market) => {
          const createdId =
            market && typeof market.id === "string" && market.id ? market.id : null;
          const createdName =
            market && typeof market.name === "string" && market.name ? market.name : name;
          return mutated(current, `“${createdName}” is on the books.`, {
            newMarketOpen: false,
            view: "overview",
            ...(createdId ? { selectedMarketId: createdId } : {}),
          });
        },
        onFailure: actions.mutationFailed,
      }),
    ];
  },

  submitNewVendor: (state, event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement | null;
    if (!form) return state;

    const data = new FormData(form);
    const name = readText(data.get("name"));
    const marketId = readText(data.get("marketId")) || state.selectedMarketId || "";

    if (!name) {
      return { ...state, mutationError: "Give the vendor a name before adding them." };
    }
    if (!marketId) {
      return { ...state, mutationError: "Pick a market for this vendor first." };
    }

    const category = readText(data.get("category"));
    const stall = readText(data.get("stall"));
    const contact = readText(data.get("contact"));
    const fee = readNumber(data.get("fee"));
    const statusEntry = readText(data.get("status"));
    const status: VendorStatus =
      statusEntry === "confirmed" || statusEntry === "waitlist" ? statusEntry : "pending";

    const input: NewVendorInput = {
      marketId,
      name,
      status,
      ...(category ? { category } : {}),
      ...(stall ? { stall } : {}),
      ...(contact ? { contact } : {}),
      ...(fee !== undefined ? { fee } : {}),
    };

    return [
      { ...state, pending: "form:vendor", mutationError: null },
      requestEffect<Vendor>({
        run: () => createVendor(input),
        onSuccess: (current, vendor) => {
          const createdName =
            vendor && typeof vendor.name === "string" && vendor.name ? vendor.name : name;
          return mutated(current, `${createdName} joined the roster.`, {
            vendorFormKey: current.vendorFormKey + 1,
          });
        },
        onFailure: actions.mutationFailed,
      }),
    ];
  },

  // Effect-only actions (dispatched by effecters, never by the view).
  dashboardLoaded: (state, dashboard) => ({
    ...state,
    dashboard,
    loading: false,
    error: null,
    pending: null,
    loadedAt: new Date().toISOString(),
    selectedMarketId: pickMarketId(state.selectedMarketId, dashboard),
  }),

  dashboardFailed: (state, error) => ({
    ...state,
    loading: false,
    pending: null,
    error:
      state.dashboard === null
        ? error.message
        : `Refresh failed, showing the last loaded snapshot. ${error.message}`,
  }),

  mutationFailed: (state, error) => ({
    ...state,
    pending: null,
    mutationError: error.message,
  }),
};

/* -------------------------------------------------------------------------- */
/* Small view helpers                                                         */
/* -------------------------------------------------------------------------- */

function iconPaths(name: "calendar" | "roster" | "tasks" | "gauge"): string[] {
  switch (name) {
    case "calendar":
      return ["M7 3v3", "M17 3v3", "M4 8h16", "M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"];
    case "roster":
      return [
        "M15.5 19.5v-1.6a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 17.9v1.6",
        "M9.75 11.4a3.45 3.45 0 1 0 0-6.9 3.45 3.45 0 0 0 0 6.9z",
        "M20 19.5v-1.6a3.4 3.4 0 0 0-2.5-3.25",
        "M15.6 4.7a3.4 3.4 0 0 1 0 6.6",
      ];
    case "tasks":
      return [
        "M10 6h9",
        "M10 12h9",
        "M10 18h9",
        "M4 6.2l1.5 1.5L8.2 5",
        "M4 12l1.5 1.5L8.2 10.8",
        "M4 17.8l1.5 1.5L8.2 16.5",
      ];
    case "gauge":
    default:
      return ["M4.5 19.5a8.5 8.5 0 1 1 15 0", "M12 15.5l3.2-4.2"];
  }
}

function strokeIcon(name: "calendar" | "roster" | "tasks" | "gauge"): VNode<State> {
  return h(
    "svg",
    {
      class: "metric-icon-glyph",
      viewBox: "0 0 24 24",
      width: "20",
      height: "20",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    iconPaths(name).map((d) => h("path", { d })),
  );
}

function plusIcon(): VNode<State> {
  return h(
    "svg",
    {
      class: "button-icon",
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    [h("path", { d: "M12 5v14" }), h("path", { d: "M5 12h14" })],
  );
}

function refreshIcon(): VNode<State> {
  return h(
    "svg",
    {
      class: "button-icon",
      viewBox: "0 0 24 24",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.8",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    [
      h("path", { d: "M20 12a8 8 0 1 1-2.3-5.6" }),
      h("path", { d: "M20 4v4.5h-4.5" }),
    ],
  );
}

function progressBar(
  percent: number,
  label: string,
  valueNow?: number,
  valueMax?: number,
  extraClass?: string,
): VNode<State> {
  const attributes: Record<string, unknown> = {
    class: ["progress-bar", extraClass ?? null],
    role: "progressbar",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": valueMax ?? 100,
    "aria-valuenow": valueNow ?? percent,
  };
  return h("div", attributes, [
    h("span", { class: "progress-fill", style: { width: `${percent}%` } }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: top bar, header, notices                                             */
/* -------------------------------------------------------------------------- */

function brandView(): VNode<State> {
  return h("div", { class: "brand" }, [
    h(
      "svg",
      {
        class: "brand-mark",
        viewBox: "0 0 32 32",
        width: "30",
        height: "30",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.8",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
      },
      [
        h("path", { d: "M4 13 16 4l12 9" }),
        h("path", { d: "M6.5 13v13a1 1 0 0 0 1 1h17a1 1 0 0 0 1-1V13" }),
        h("path", { d: "M12.5 27v-7.5h7V27" }),
      ],
    ),
    h("div", { class: "brand-text" }, [
      h("span", { class: "brand-name" }, [text("Stallmate")]),
      h("span", { class: "eyebrow" }, [text("Market operations desk")]),
    ]),
  ]);
}

function topbarView(state: State): VNode<State> {
  const refreshing = state.pending === "refresh";
  return h("header", { class: "topbar" }, [
    h("div", { class: "topbar-inner" }, [
      brandView(),
      h(
        "nav",
        { class: "tabs view-switcher", "aria-label": "Dashboard views" },
        VIEW_TABS.map((tab) =>
          h(
            "button",
            {
              type: "button",
              class: ["tab", state.view === tab.id && "is-active"],
              "aria-current": state.view === tab.id ? "page" : undefined,
              onclick: [actions.setView, tab.id],
            },
            [text(tab.label)],
          ),
        ),
      ),
      h("div", { class: "topbar-actions" }, [
        h(
          "button",
          {
            type: "button",
            class: "button button-ghost",
            onclick: actions.refresh,
            disabled: refreshing,
            "aria-label": "Refresh dashboard",
          },
          [refreshIcon(), text(refreshing ? "Refreshing…" : "Refresh")],
        ),
        h(
          "button",
          {
            type: "button",
            class: "button button-primary",
            onclick: actions.openNewMarket,
          },
          [plusIcon(), text("New market")],
        ),
      ]),
    ]),
  ]);
}

function pageHeaderView(state: State): VNode<State> {
  const dashboard = state.dashboard;
  const markets = dashboard?.markets ?? [];
  const market = selectedMarket(state);
  const asOf = state.loadedAt ?? null;

  return h("section", { class: "page-header" }, [
    h("div", { class: "page-header-text" }, [
      h("p", { class: "eyebrow" }, [text("Market operations desk")]),
      h("h1", { class: "page-title" }, [text("Good morning, market maker")]),
      h("p", { class: "page-meta" }, [
        text("As of "),
        h("time", { datetime: asOf ?? "" }, [text(formatClock(asOf))]),
        text(" · "),
        text(
          dashboard
            ? `${plural(markets.length, "market")} on the desk`
            : "connecting to the desk",
        ),
        market ? text(` · ${plural(market.capacity, "stall")} capacity`) : null,
      ]),
    ]),
    h("div", { class: "market-picker" }, [
      h("label", { class: "field-label", for: "market-picker-select" }, [text("Working market")]),
      h(
        "select",
        {
          id: "market-picker-select",
          class: "select",
          key: `market-picker-${markets.length}-${market?.id ?? "none"}`,
          value: market?.id ?? "",
          onchange: actions.selectMarket,
          disabled: markets.length === 0,
        },
        markets.length === 0
          ? [h("option", { value: "" }, [text("No markets yet")])]
          : markets.map((item) =>
              h(
                "option",
                { value: item.id, selected: market?.id === item.id },
                [text(`${item.name} · ${formatMarketDate(item.date)}`)],
              ),
            ),
      ),
    ]),
  ]);
}

function noticesView(state: State): Array<VNode<State> | null> {
  const inlineErrorVisible = !state.newMarketOpen && !state.vendorFormOpen;
  return [
    state.notice
      ? h(
          "div",
          {
            class: "notice notice-success",
            role: "status",
            "aria-live": "polite",
          },
          [
            h("span", { class: "notice-mark", "aria-hidden": "true" }, [text("✓")]),
            h("p", { class: "notice-body" }, [text(state.notice.message)]),
            h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": "Dismiss notice",
                onclick: actions.dismissNotice,
              },
              [text("✕")],
            ),
          ],
        )
      : null,
    state.error
      ? h(
          "div",
          { class: "notice notice-error", role: "alert" },
          [
            h("span", { class: "notice-mark", "aria-hidden": "true" }, [text("!")]),
            h("p", { class: "notice-body" }, [text(state.error)]),
            h(
              "button",
              { type: "button", class: "button button-subtle", onclick: actions.refresh },
              [text("Retry")],
            ),
            h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": "Dismiss error",
                onclick: actions.dismissError,
              },
              [text("✕")],
            ),
          ],
        )
      : null,
    state.mutationError && inlineErrorVisible
      ? h(
          "div",
          { class: "notice notice-error", role: "alert" },
          [
            h("span", { class: "notice-mark", "aria-hidden": "true" }, [text("!")]),
            h("p", { class: "notice-body" }, [text(state.mutationError)]),
            h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": "Dismiss error",
                onclick: actions.dismissMutationError,
              },
              [text("✕")],
            ),
          ],
        )
      : null,
  ];
}

/* -------------------------------------------------------------------------- */
/* View: metrics and market hero                                              */
/* -------------------------------------------------------------------------- */

function metricCard(options: {
  icon: "calendar" | "roster" | "tasks" | "gauge";
  tone: string;
  label: string;
  value: string;
  support: string;
  percent: number | null;
}): VNode<State> {
  return h("article", { class: "metric-card", "data-tone": options.tone }, [
    h("div", { class: "metric-head" }, [
      h("span", { class: "metric-icon", "aria-hidden": "true" }, [strokeIcon(options.icon)]),
      h("p", { class: "metric-label" }, [text(options.label)]),
    ]),
    h("p", { class: "metric-value" }, [text(options.value)]),
    h("p", { class: "metric-support" }, [text(options.support)]),
    options.percent === null
      ? null
      : progressBar(options.percent, `${options.label} progress`, undefined, undefined, "progress-bar-compact"),
  ]);
}

function metricGridView(state: State): VNode<State> {
  const metrics = state.dashboard?.metrics ?? null;
  const dash = "—";

  return h("section", { class: "metric-grid", "aria-label": "Desk metrics" }, [
    metricCard({
      icon: "calendar",
      tone: "accent",
      label: "Upcoming markets",
      value: metrics ? String(metrics.upcomingMarkets) : dash,
      support: "Planning, confirmed, or live on the calendar",
      percent: null,
    }),
    metricCard({
      icon: "roster",
      tone: "info",
      label: "Vendor roster",
      value: metrics ? String(metrics.totalVendors) : dash,
      support: "Confirmed, pending, and waitlisted traders",
      percent: null,
    }),
    metricCard({
      icon: "tasks",
      tone: "warn",
      label: "Open setup tasks",
      value: metrics ? String(metrics.openTasks) : dash,
      support: "Still to do across every market",
      percent: null,
    }),
    metricCard({
      icon: "gauge",
      tone: "ok",
      label: "Readiness",
      value: metrics ? `${clampPercent(metrics.readiness)}%` : dash,
      support: "Checklist completion across the desk",
      percent: metrics ? clampPercent(metrics.readiness) : null,
    }),
  ]);
}

function statusPill(status: MarketStatus): VNode<State> {
  return h("span", { class: ["status-pill", `status-${status}`], "data-status": status }, [
    h("span", { class: "status-dot", "aria-hidden": "true" }),
    text(MARKET_STATUS_LABEL[status]),
  ]);
}

function marketHeroEmptyView(state: State): VNode<State> {
  const hasDashboard = state.dashboard !== null;
  return h("section", { class: "market-hero market-hero-empty" }, [
    h("div", { class: "empty-state" }, [
      h("p", { class: "empty-eyebrow" }, [text("Selected market")]),
      h("h2", { class: "empty-title" }, [
        text(hasDashboard ? "No markets on the desk yet" : "Waiting for the operations desk"),
      ]),
      h("p", { class: "empty-hint" }, [
        text(
          hasDashboard
            ? "Create the first market to start planning vendors, stalls, and setup tasks."
            : "The dashboard could not load. Retry the request — the shell stays usable either way.",
        ),
      ]),
      h("div", { class: "empty-actions" }, [
        h(
          "button",
          {
            type: "button",
            class: "button button-primary",
            onclick: actions.openNewMarket,
            disabled: !hasDashboard,
          },
          [plusIcon(), text("New market")],
        ),
        hasDashboard
          ? null
          : h(
              "button",
              { type: "button", class: "button button-ghost", onclick: actions.refresh },
              [refreshIcon(), text("Retry")],
            ),
      ]),
    ]),
  ]);
}

function marketHeroView(state: State): VNode<State> {
  const market = selectedMarket(state);
  if (!market) return marketHeroEmptyView(state);

  const marketVendors = vendorsForMarket(state, market.id);
  const marketTasks = tasksForMarket(state, market.id);
  const progress = progressOf(marketTasks);
  const allocated = marketVendors.filter((vendor) => vendor.status !== "waitlist").length;
  const capacity = market.capacity > 0 ? market.capacity : 0;
  const usagePercent = capacity > 0 ? clampPercent((allocated / capacity) * 100) : 0;
  const checkedIn = marketVendors.filter((vendor) => vendor.checkedIn).length;
  const openTasks = marketTasks.filter((task) => !task.completed).length;
  const pending = state.pending === `status:${market.id}`;

  return h("section", { class: "market-hero", "aria-labelledby": "market-hero-title" }, [
    h("div", { class: "market-hero-main" }, [
      h("p", { class: "eyebrow" }, [text("Selected market")]),
      h("div", { class: "market-hero-heading" }, [
        h("h2", { class: "market-hero-title", id: "market-hero-title" }, [text(market.name)]),
        statusPill(market.status),
      ]),
      h("p", { class: "market-hero-meta" }, [
        h("span", { class: "market-hero-venue" }, [text(market.venue)]),
        text(" · "),
        h("span", { class: "market-hero-neighborhood" }, [text(market.neighborhood)]),
        text(" · "),
        h("time", { class: "market-hero-date", datetime: market.date }, [
          text(formatMarketDate(market.date)),
        ]),
      ]),
      market.notes ? h("p", { class: "market-hero-notes" }, [text(market.notes)]) : null,
      h("div", { class: "capacity" }, [
        h("div", { class: "capacity-head" }, [
          h("span", { class: "capacity-label" }, [text("Stall allocation")]),
          h("span", { class: "capacity-value" }, [
            text(
              capacity > 0
                ? `${allocated} of ${capacity} stalls allocated`
                : "No stall capacity set",
            ),
          ]),
        ]),
        progressBar(
          usagePercent,
          "Stall allocation",
          allocated,
          capacity > 0 ? capacity : 100,
        ),
        h("p", { class: "capacity-note" }, [
          text(
            [
              `${plural(marketVendors.length, "vendor")} on this market`,
              checkedIn > 0 ? `${checkedIn} checked in` : null,
            ]
              .filter((part): part is string => Boolean(part))
              .join(" · "),
          ),
        ]),
      ]),
    ]),
    h("div", { class: "market-hero-side" }, [
      h("div", { class: "status-controls", role: "group", "aria-label": "Change market status" }, [
        h("p", { class: "status-controls-label" }, [text("Market status")]),
        h(
          "div",
          { class: "status-options" },
          MARKET_STATUS_ORDER.map((status) => {
            const isCurrent = market.status === status;
            return h(
              "button",
              {
                type: "button",
                class: ["status-option", isCurrent && "is-current"],
                "aria-pressed": isCurrent ? "true" : "false",
                title: MARKET_STATUS_HINT[status],
                disabled: isCurrent || pending,
                onclick: [actions.setMarketStatus, { id: market.id, status }],
              },
              [
                h("span", { class: "status-option-dot", "aria-hidden": "true" }),
                h("span", { class: "status-option-copy" }, [
                  h("span", { class: "status-option-label" }, [text(MARKET_STATUS_LABEL[status])]),
                  h("span", { class: "status-option-hint" }, [text(MARKET_STATUS_HINT[status])]),
                ]),
              ],
            );
          }),
        ),
      ]),
      h("dl", { class: "market-facts" }, [
        h("div", { class: "fact" }, [
          h("dt", { class: "fact-label" }, [text("Checked in")]),
          h("dd", { class: "fact-value" }, [
            text(marketVendors.length > 0 ? `${checkedIn} / ${marketVendors.length}` : "—"),
          ]),
        ]),
        h("div", { class: "fact" }, [
          h("dt", { class: "fact-label" }, [text("Open tasks")]),
          h("dd", { class: "fact-value" }, [text(String(openTasks))]),
        ]),
        h("div", { class: "fact" }, [
          h("dt", { class: "fact-label" }, [text("Setup progress")]),
          h("dd", { class: "fact-value" }, [
            text(progress.total > 0 ? `${progress.percent}%` : "—"),
          ]),
        ]),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: sidebar (Today's brief)                                              */
/* -------------------------------------------------------------------------- */

function sidebarView(state: State): VNode<State> {
  const market = selectedMarket(state);
  const marketVendors = vendorsForMarket(state, market?.id ?? null);
  const marketTasks = tasksForMarket(state, market?.id ?? null);
  const brief = buildBrief(state, market, marketVendors, marketTasks);

  return h("aside", { class: "sidebar", "aria-label": "Today's brief" }, [
    h("section", { class: "panel panel-brief" }, [
      h("div", { class: "panel-head" }, [
        h("h2", { class: "panel-title" }, [text("Today's brief")]),
        h("span", { class: "panel-badge" }, [
          text(brief.length === 1 && brief[0].id === "clear" ? "Clear" : plural(brief.length, "item")),
        ]),
      ]),
      h(
        "ol",
        { class: "brief-list" },
        brief.map((item) =>
          h("li", { class: ["brief-item", `is-${item.tone}`], key: item.id }, [
            h("span", { class: "brief-dot", "aria-hidden": "true" }),
            h("div", { class: "brief-copy" }, [
              h("p", { class: "brief-text" }, [text(item.text)]),
              h("p", { class: "brief-hint" }, [text(item.hint)]),
            ]),
            item.view
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "link-button",
                    onclick: [actions.setView, item.view],
                  },
                  [text(item.action)],
                )
              : null,
          ]),
        ),
      ),
    ]),
    h("section", { class: "panel panel-note" }, [
      h("h2", { class: "panel-title" }, [text("Desk notes")]),
      h("p", { class: "panel-copy" }, [
        text(
          "Stallmate keeps a single source of truth for the weekend: markets, vendors, stalls, and setup tasks. Mutations refresh the whole desk so nothing drifts.",
        ),
      ]),
      h("p", { class: "panel-copy panel-copy-muted" }, [
        text("Storage is in memory — the seeded plan resets when the server restarts."),
      ]),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: overview                                                             */
/* -------------------------------------------------------------------------- */

function overviewView(state: State): VNode<State> {
  const market = selectedMarket(state);
  const marketVendors = vendorsForMarket(state, market?.id ?? null);
  const marketTasks = tasksForMarket(state, market?.id ?? null);
  const progress = progressOf(marketTasks);
  const nextTasks = marketTasks.filter((task) => !task.completed).sort(compareByDueTime).slice(0, 3);
  const activity: Activity[] = [...(state.dashboard?.activity ?? [])]
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    .slice(0, 8);
  const now = Date.now();

  const statusCounts = VENDOR_STATUS_ORDER.map((status) => ({
    status,
    count: marketVendors.filter((vendor) => vendor.status === status).length,
  }));
  const vendorTotal = marketVendors.length;

  return h("div", { class: "overview-view" }, [
    h("div", { class: "panel-grid" }, [
      h("section", { class: "panel panel-progress" }, [
        h("div", { class: "panel-head" }, [
          h("h3", { class: "panel-title" }, [text("Setup progress")]),
          h("span", { class: "panel-badge" }, [
            text(progress.total > 0 ? `${progress.done} / ${progress.total} done` : "No tasks"),
          ]),
        ]),
        progressBar(progress.percent, "Setup task completion", progress.done, progress.total || 100),
        h("p", { class: "panel-copy" }, [
          text(
            progress.total === 0
              ? "No setup tasks are planned for this market yet."
              : progress.percent === 100
                ? "Every setup task is checked off. Ready for doors."
                : `${plural(progress.total - progress.done, "task")} still open before doors.`,
          ),
        ]),
        nextTasks.length > 0
          ? h(
              "ul",
              { class: "next-list" },
              nextTasks.map((task) =>
                h("li", { class: "next-item", key: task.id }, [
                  h("span", { class: "next-dot", "aria-hidden": "true" }),
                  h("span", { class: "next-title" }, [text(task.title)]),
                  h("span", { class: "next-meta" }, [
                    text(`${formatDueTime(task.dueTime)}${task.assignee ? ` · ${task.assignee}` : ""}`),
                  ]),
                ]),
              ),
            )
          : null,
        h(
          "button",
          {
            type: "button",
            class: "link-button",
            onclick: [actions.setView, "setup"],
          },
          [text("Open the setup plan →")],
        ),
      ]),
      h("section", { class: "panel panel-vendors" }, [
        h("div", { class: "panel-head" }, [
          h("h3", { class: "panel-title" }, [text("Vendor status")]),
          h("span", { class: "panel-badge" }, [text(plural(vendorTotal, "vendor"))]),
        ]),
        vendorTotal === 0
          ? h("p", { class: "panel-copy" }, [
              text("No vendors are attached to this market yet."),
            ])
          : h(
              "ul",
              { class: "summary-list" },
              statusCounts.map(({ status, count }) =>
                h("li", { class: "summary-row", key: status }, [
                  h("span", { class: ["summary-dot", `is-${status}`], "aria-hidden": "true" }),
                  h("span", { class: "summary-label" }, [text(VENDOR_STATUS_LABEL[status])]),
                  h("span", { class: "summary-count" }, [text(String(count))]),
                  h("span", { class: "summary-bar", "aria-hidden": "true" }, [
                    h("span", {
                      class: ["summary-fill", `is-${status}`],
                      style: {
                        width: `${vendorTotal > 0 ? clampPercent((count / vendorTotal) * 100) : 0}%`,
                      },
                    }),
                  ]),
                ]),
              ),
            ),
        h(
          "button",
          {
            type: "button",
            class: "link-button",
            onclick: [actions.setView, "vendors"],
          },
          [text("Open the vendor roster →")],
        ),
      ]),
    ]),
    h("section", { class: "panel panel-activity" }, [
      h("div", { class: "panel-head" }, [
        h("h3", { class: "panel-title" }, [text("Recent activity")]),
        h("span", { class: "panel-badge" }, [text("Live feed")]),
      ]),
      activity.length === 0
        ? h("div", { class: "empty-state empty-state-compact" }, [
            h("p", { class: "empty-title" }, [text("No activity recorded yet")]),
            h("p", { class: "empty-hint" }, [
              text("Vendor and setup changes will appear here as the desk is used."),
            ]),
          ])
        : h(
            "ol",
            { class: "activity-list" },
            activity.map((item) =>
              h("li", { class: "activity-item", key: item.id, "data-kind": item.kind }, [
                h("span", {
                  class: ["activity-dot", `is-${activityTone(item.kind)}`],
                  "aria-hidden": "true",
                }),
                h("div", { class: "activity-copy" }, [
                  h("p", { class: "activity-message" }, [text(item.message)]),
                  h("p", { class: "activity-meta" }, [
                    h("span", { class: "activity-kind" }, [text(activityLabel(item.kind))]),
                    text(" · "),
                    h("time", { datetime: item.timestamp, title: item.timestamp }, [
                      text(formatRelativeTime(item.timestamp, now)),
                    ]),
                  ]),
                ]),
              ]),
            ),
          ),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: vendors                                                              */
/* -------------------------------------------------------------------------- */

function vendorFormView(state: State, market: Market | null): VNode<State> {
  const markets = state.dashboard?.markets ?? [];
  const busy = state.pending === "form:vendor";
  const defaultMarketId = market?.id ?? markets[0]?.id ?? "";

  return h(
    "form",
    {
      class: "panel vendor-form",
      onsubmit: actions.submitNewVendor,
      key: `vendor-form-${state.vendorFormKey}-${defaultMarketId}`,
      "aria-labelledby": "vendor-form-title",
    },
    [
      h("div", { class: "panel-head" }, [
        h("h3", { class: "panel-title", id: "vendor-form-title" }, [text("Add vendor")]),
        h("button", {
          type: "button",
          class: "icon-button",
          "aria-label": "Close add vendor form",
          onclick: actions.toggleVendorForm,
        }, [text("✕")]),
      ]),
      h("div", { class: "form-grid" }, [
        h("div", { class: "form-field form-field-wide" }, [
          h("label", { class: "field-label", for: "vendor-name" }, [
            text("Vendor name *"),
          ]),
          h("input", {
            id: "vendor-name",
            class: "input",
            type: "text",
            name: "name",
            required: true,
            autocomplete: "off",
            placeholder: "e.g. Bramble & Rye",
          }),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-category" }, [text("Category")]),
          h("input", {
            id: "vendor-category",
            class: "input",
            type: "text",
            name: "category",
            placeholder: "e.g. Bakery",
          }),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-stall" }, [text("Stall")]),
          h("input", {
            id: "vendor-stall",
            class: "input",
            type: "text",
            name: "stall",
            placeholder: "e.g. A12",
          }),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-contact" }, [text("Contact")]),
          h("input", {
            id: "vendor-contact",
            class: "input",
            type: "text",
            name: "contact",
            placeholder: "email or phone",
          }),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-fee" }, [text("Stall fee")]),
          h("input", {
            id: "vendor-fee",
            class: "input",
            type: "number",
            name: "fee",
            min: "0",
            step: "1",
            inputmode: "decimal",
            placeholder: "e.g. 45",
          }),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-status" }, [text("Status")]),
          h(
            "select",
            { id: "vendor-status", class: "select", name: "status", value: "pending" },
            VENDOR_STATUS_ORDER.map((status) =>
              h("option", { value: status, selected: status === "pending" }, [
                text(VENDOR_STATUS_LABEL[status]),
              ]),
            ),
          ),
        ]),
        h("div", { class: "form-field" }, [
          h("label", { class: "field-label", for: "vendor-market" }, [text("Market")]),
          h(
            "select",
            {
              id: "vendor-market",
              class: "select",
              name: "marketId",
              value: defaultMarketId,
            },
            markets.map((item) =>
              h("option", { value: item.id, selected: item.id === defaultMarketId }, [
                text(item.name),
              ]),
            ),
          ),
        ]),
      ]),
      state.mutationError
        ? h("p", { class: "form-error", role: "alert" }, [text(state.mutationError)])
        : null,
      h("div", { class: "form-actions" }, [
        h(
          "button",
          { type: "submit", class: "button button-primary", disabled: busy },
          [text(busy ? "Adding…" : "Add vendor")],
        ),
        h(
          "button",
          { type: "button", class: "button button-ghost", onclick: actions.toggleVendorForm },
          [text("Cancel")],
        ),
      ]),
    ],
  );
}

function vendorRowView(state: State, vendor: Vendor): VNode<State> {
  const busy = state.pending === `vendor:${vendor.id}`;
  return h("tr", { class: ["vendor-row", vendor.checkedIn && "is-checked-in"], key: vendor.id }, [
    h("th", { class: "vendor-cell vendor-name", scope: "row" }, [
      h("span", { class: "vendor-name-text" }, [text(vendor.name)]),
      vendor.checkedIn
        ? h("span", { class: "badge badge-checked-in" }, [text("On site")])
        : null,
    ]),
    h("td", { class: "vendor-cell" }, [text(vendor.category || "—")]),
    h("td", { class: "vendor-cell" }, [
      h("span", { class: "stall-tag" }, [text(vendor.stall || "TBC")]),
    ]),
    h("td", { class: "vendor-cell vendor-contact" }, [text(vendor.contact || "—")]),
    h("td", { class: "vendor-cell vendor-fee" }, [text(formatFee(vendor.fee))]),
    h("td", { class: "vendor-cell" }, [
      h("span", { class: ["status-pill", `vendor-${vendor.status}`], "data-status": vendor.status }, [
        h("span", { class: "status-dot", "aria-hidden": "true" }),
        text(VENDOR_STATUS_LABEL[vendor.status]),
      ]),
    ]),
    h("td", { class: "vendor-cell vendor-checkin" }, [
      h(
        "button",
        {
          type: "button",
          class: ["button", "button-subtle", "checkin-toggle", vendor.checkedIn && "is-on"],
          "aria-pressed": vendor.checkedIn ? "true" : "false",
          disabled: busy,
          "aria-label": `${vendor.checkedIn ? "Check out" : "Check in"} ${vendor.name}`,
          onclick: [actions.toggleVendorCheckIn, vendor.id],
        },
        [text(busy ? "Saving…" : vendor.checkedIn ? "Check out" : "Check in")],
      ),
    ]),
  ]);
}

function vendorsView(state: State, market: Market | null): VNode<State> {
  const marketVendors = vendorsForMarket(state, market?.id ?? null);
  const visible = visibleVendors(state, marketVendors);
  const hasVendors = marketVendors.length > 0;
  const filters: Array<{ id: VendorFilter; label: string }> = [
    { id: "all", label: "All" },
    ...VENDOR_STATUS_ORDER.map((status) => ({ id: status as VendorFilter, label: VENDOR_STATUS_LABEL[status] })),
  ];

  return h("div", { class: "vendors-view" }, [
    h("div", { class: "vendor-toolbar" }, [
      h("div", { class: "search-field" }, [
        h("label", { class: "field-label", for: "vendor-search" }, [text("Search vendors")]),
        h("input", {
          id: "vendor-search",
          class: "input",
          type: "search",
          name: "q",
          value: state.vendorQuery,
          placeholder: "Name, category, stall, or contact",
          autocomplete: "off",
          oninput: actions.setVendorQuery,
        }),
      ]),
      h(
        "div",
        { class: "filter-chips", role: "group", "aria-label": "Filter vendors by status" },
        filters.map((filter) =>
          h(
            "button",
            {
              type: "button",
              class: ["chip", state.vendorFilter === filter.id && "is-active"],
              "aria-pressed": state.vendorFilter === filter.id ? "true" : "false",
              onclick: [actions.setVendorFilter, filter.id],
            },
            [text(filter.label)],
          ),
        ),
      ),
      h(
        "button",
        {
          type: "button",
          class: "button button-primary",
          "aria-expanded": state.vendorFormOpen ? "true" : "false",
          onclick: actions.toggleVendorForm,
        },
        [plusIcon(), text(state.vendorFormOpen ? "Close form" : "Add vendor")],
      ),
    ]),
    state.vendorFormOpen ? vendorFormView(state, market) : null,
    !hasVendors
      ? h("div", { class: "empty-state" }, [
          h("h3", { class: "empty-title" }, [
            text(market ? "No vendors on this market yet" : "No markets to attach vendors to"),
          ]),
          h("p", { class: "empty-hint" }, [
            text(
              market
                ? "Add the first vendor to start building the stall line-up."
                : "Create a market first — vendors always belong to a market.",
            ),
          ]),
          market
            ? h("div", { class: "empty-actions" }, [
                h(
                  "button",
                  {
                    type: "button",
                    class: "button button-primary",
                    onclick: actions.toggleVendorForm,
                  },
                  [plusIcon(), text("Add vendor")],
                ),
              ])
            : null,
        ])
      : visible.length === 0
        ? h("div", { class: "empty-state" }, [
            h("h3", { class: "empty-title" }, [text("No vendors match your filters")]),
            h("p", { class: "empty-hint" }, [
              text(
                state.vendorQuery
                  ? `Nothing found for “${state.vendorQuery}”. Try a different name or clear the filters.`
                  : "No vendors have this status yet.",
              ),
            ]),
            h("div", { class: "empty-actions" }, [
              h(
                "button",
                {
                  type: "button",
                  class: "button button-ghost",
                  onclick: actions.clearVendorFilters,
                },
                [text("Clear filters")],
              ),
            ]),
          ])
        : h("div", { class: "table-scroll" }, [
            h(
              "table",
              { class: "vendor-table", "aria-label": `Vendors on ${market?.name ?? "the roster"}` },
              [
                h("thead", {}, [
                  h("tr", {}, [
                    h("th", { scope: "col" }, [text("Vendor")]),
                    h("th", { scope: "col" }, [text("Category")]),
                    h("th", { scope: "col" }, [text("Stall")]),
                    h("th", { scope: "col" }, [text("Contact")]),
                    h("th", { scope: "col" }, [text("Fee")]),
                    h("th", { scope: "col" }, [text("Status")]),
                    h("th", { scope: "col" }, [text("Check-in")]),
                  ]),
                ]),
                h("tbody", {}, visible.map((vendor) => vendorRowView(state, vendor))),
              ],
            ),
            h("p", { class: "table-caption" }, [
              text(`Showing ${visible.length} of ${marketVendors.length} vendors`),
            ]),
          ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: setup                                                                */
/* -------------------------------------------------------------------------- */

function taskMetaNodes(parts: string[]): Array<VNode<State>> {
  const nodes: Array<VNode<State>> = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push(h("span", { class: "task-meta-sep", "aria-hidden": "true" }, [text("·")]));
    }
    nodes.push(h("span", { class: "task-meta-item" }, [text(part)]));
  });
  return nodes;
}

function taskItemView(state: State, task: SetupTask): VNode<State> {
  const busy = state.pending === `task:${task.id}`;
  const checkboxId = `task-${task.id}`;
  const meta = [task.assignee || "Unassigned", task.area || "General", `Due ${formatDueTime(task.dueTime)}`];

  return h("li", { class: ["task-item", task.completed && "is-complete"], key: task.id }, [
    h("input", {
      id: checkboxId,
      class: "task-check",
      type: "checkbox",
      checked: task.completed,
      disabled: busy,
      onchange: [actions.toggleTask, task.id],
    }),
    h("div", { class: "task-body" }, [
      h("label", { class: "task-title", for: checkboxId }, [text(task.title)]),
      h("p", { class: "task-meta" }, taskMetaNodes(meta)),
    ]),
    h("span", { class: "task-state" }, [text(task.completed ? "Done" : busy ? "Saving…" : "Open")]),
  ]);
}

function setupView(state: State, market: Market | null): VNode<State> {
  const marketTasks = tasksForMarket(state, market?.id ?? null);
  const progress = progressOf(marketTasks);
  const groups = groupTasksByArea(marketTasks);

  return h("div", { class: "setup-view" }, [
    h("section", { class: "panel panel-progress" }, [
      h("div", { class: "panel-head" }, [
        h("h3", { class: "panel-title" }, [text("Setup progress")]),
        h("span", { class: "panel-badge" }, [
          text(progress.total > 0 ? `${progress.done} / ${progress.total} done` : "No tasks"),
        ]),
      ]),
      progressBar(progress.percent, "Setup task completion", progress.done, progress.total || 100),
      h("p", { class: "panel-copy" }, [
        text(
          progress.total === 0
            ? "No setup tasks for this market yet."
            : progress.percent === 100
              ? "All setup tasks complete — the market is ready."
              : `${plural(progress.total - progress.done, "task")} remaining · ${progress.percent}% complete`,
        ),
      ]),
    ]),
    marketTasks.length === 0
      ? h("div", { class: "empty-state" }, [
          h("h3", { class: "empty-title" }, [
            text(market ? "No setup tasks planned yet" : "No market selected"),
          ]),
          h("p", { class: "empty-hint" }, [
            text(
              market
                ? "Setup tasks arrive with the market plan. Once the API seeds tasks for this market they group here by area."
                : "Pick a market from the header to see its setup plan.",
            ),
          ]),
        ])
      : h(
          "div",
          { class: "task-groups" },
          groups.map((group) => {
            const groupProgress = progressOf(group.tasks);
            return h("section", { class: "task-group", key: group.area }, [
              h("div", { class: "task-group-head" }, [
                h("h3", { class: "task-group-title" }, [text(group.area)]),
                h("span", { class: "panel-badge" }, [
                  text(
                    groupProgress.done === groupProgress.total
                      ? "All done"
                      : `${groupProgress.done} / ${groupProgress.total}`,
                  ),
                ]),
              ]),
              h("ul", { class: "task-list" }, group.tasks.map((task) => taskItemView(state, task))),
            ]);
          }),
        ),
  ]);
}

/* -------------------------------------------------------------------------- */
/* View: new market modal                                                     */
/* -------------------------------------------------------------------------- */

function newMarketModalView(state: State): VNode<State> {
  const busy = state.pending === "form:market";
  return h(
    "div",
    {
      class: "modal-backdrop",
      onclick: actions.closeNewMarketFromBackdrop,
      onkeydown: actions.closeNewMarketFromKey,
    },
    [
      h(
        "div",
        {
          class: "modal",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "new-market-title",
        },
        [
          h("div", { class: "modal-head" }, [
            h("div", {}, [
              h("p", { class: "eyebrow" }, [text("Plan a weekend")]),
              h("h2", { class: "modal-title", id: "new-market-title" }, [text("New market")]),
            ]),
            h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": "Close new market dialog",
                onclick: actions.closeNewMarket,
              },
              [text("✕")],
            ),
          ]),
          h("form", { class: "modal-body", onsubmit: actions.submitNewMarket }, [
            h("div", { class: "form-grid" }, [
              h("div", { class: "form-field form-field-wide" }, [
                h("label", { class: "field-label", for: "new-market-name" }, [
                  text("Market name *"),
                ]),
                h("input", {
                  id: "new-market-name",
                  class: "input",
                  type: "text",
                  name: "name",
                  required: true,
                  autocomplete: "off",
                  placeholder: "e.g. Riverside Makers Market",
                }),
              ]),
              h("div", { class: "form-field" }, [
                h("label", { class: "field-label", for: "new-market-date" }, [text("Date *")]),
                h("input", {
                  id: "new-market-date",
                  class: "input",
                  type: "date",
                  name: "date",
                  required: true,
                }),
              ]),
              h("div", { class: "form-field" }, [
                h("label", { class: "field-label", for: "new-market-venue" }, [text("Venue *")]),
                h("input", {
                  id: "new-market-venue",
                  class: "input",
                  type: "text",
                  name: "venue",
                  required: true,
                  autocomplete: "off",
                  placeholder: "e.g. Riverside Yard",
                }),
              ]),
              h("div", { class: "form-field" }, [
                h("label", { class: "field-label", for: "new-market-neighborhood" }, [
                  text("Neighborhood *"),
                ]),
                h("input", {
                  id: "new-market-neighborhood",
                  class: "input",
                  type: "text",
                  name: "neighborhood",
                  required: true,
                  autocomplete: "off",
                  placeholder: "e.g. Riverside",
                }),
              ]),
              h("div", { class: "form-field" }, [
                h("label", { class: "field-label", for: "new-market-capacity" }, [
                  text("Stall capacity"),
                ]),
                h("input", {
                  id: "new-market-capacity",
                  class: "input",
                  type: "number",
                  name: "capacity",
                  min: "1",
                  step: "1",
                  inputmode: "numeric",
                  placeholder: "e.g. 24",
                }),
              ]),
              h("div", { class: "form-field form-field-wide" }, [
                h("label", { class: "field-label", for: "new-market-notes" }, [text("Notes")]),
                h("textarea", {
                  id: "new-market-notes",
                  class: "textarea",
                  name: "notes",
                  rows: 3,
                  placeholder: "Anything the setup crew should know",
                }),
              ]),
            ]),
            state.mutationError
              ? h("p", { class: "form-error", role: "alert" }, [text(state.mutationError)])
              : null,
            h("div", { class: "modal-actions" }, [
              h(
                "button",
                { type: "button", class: "button button-ghost", onclick: actions.closeNewMarket },
                [text("Cancel")],
              ),
              h("button", { type: "submit", class: "button button-primary", disabled: busy }, [
                text(busy ? "Creating…" : "Create market"),
              ]),
            ]),
          ]),
        ],
      ),
    ],
  );
}

/* -------------------------------------------------------------------------- */
/* Root view + bootstrap                                                      */
/* -------------------------------------------------------------------------- */

function loadingPanelView(): VNode<State> {
  return h(
    "section",
    { class: "loading-state", role: "status", "aria-live": "polite" },
    [
      h("h2", { class: "loading-title" }, [text("Loading the operations desk…")]),
      h("div", { class: "skeleton-line" }),
      h("div", { class: "skeleton-line skeleton-line-short" }),
      h("div", { class: "skeleton-line" }),
    ],
  );
}

function contentPanelView(state: State): VNode<State> {
  const market = selectedMarket(state);
  const marketTasks = tasksForMarket(state, market?.id ?? null);
  const marketVendors = vendorsForMarket(state, market?.id ?? null);

  const headings: Record<DashboardView, { title: string; subtitle: string }> = {
    overview: {
      title: "Market overview",
      subtitle: market ? `${market.name} at a glance` : "The desk at a glance",
    },
    vendors: {
      title: "Vendor roster",
      subtitle: market
        ? `${plural(marketVendors.length, "vendor")} on ${market.name}`
        : "Vendors by market",
    },
    setup: {
      title: "Setup plan",
      subtitle: market
        ? `${plural(marketTasks.filter((task) => !task.completed).length, "open task")} before doors`
        : "Tasks grouped by area",
    },
  };
  const heading = headings[state.view];

  return h(
    "section",
    { class: "content-panel", id: "content-panel", "aria-labelledby": "content-title" },
    [
      h("div", { class: "content-head" }, [
        h("div", {}, [
          h("h2", { class: "content-title", id: "content-title" }, [text(heading.title)]),
          h("p", { class: "content-subtitle" }, [text(heading.subtitle)]),
        ]),
        state.pending === "refresh"
          ? h("span", { class: "panel-badge panel-badge-live", role: "status" }, [
              text("Refreshing…"),
            ])
          : null,
      ]),
      state.loading && state.dashboard === null
        ? loadingPanelView()
        : state.view === "overview"
          ? overviewView(state)
          : state.view === "vendors"
            ? vendorsView(state, market)
            : setupView(state, market),
    ],
  );
}

export function view(state: State): VNode<State> {
  return h("div", { class: "app-shell" }, [
    topbarView(state),
    h(
      "main",
      { class: "page", "aria-busy": state.loading ? "true" : "false" },
      [
        pageHeaderView(state),
        ...noticesView(state),
        metricGridView(state),
        marketHeroView(state),
        h("div", { class: "workspace" }, [sidebarView(state), contentPanelView(state)]),
      ],
    ),
    h("footer", { class: "app-footer" }, [
      h("span", { class: "footer-mark" }, [text("Stallmate")]),
      text(" · "),
      text("Weekend market operations · in-memory demo data"),
    ]),
    state.newMarketOpen ? newMarketModalView(state) : null,
  ]);
}

/** Mounts the dashboard onto `#app` (or any element the caller provides). */
export function bootstrapApp(node: HTMLElement | null): Dispatch<State> | null {
  if (!node) return null;
  return app<State>({
    init: [initialState, loadEffect()],
    view,
    node,
  });
}
