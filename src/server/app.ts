import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { ErrorRequestHandler, Express, Request } from 'express';
import { MarketStore, NotFoundError, ValidationError } from './store.js';
import {
  MARKET_STATUSES,
  VENDOR_STATUSES,
  isMarketStatus,
  isVendorStatus,
  type MarketStatus,
  type VendorStatus,
} from './types.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readBody = (body: unknown): Record<string, unknown> => {
  if (!isRecord(body)) throw new ValidationError('Request body must be a JSON object');
  return body;
};

const readRequiredText = (body: Record<string, unknown>, field: string): string => {
  const value = body[field];
  if (value === undefined || value === null) throw new ValidationError(`${field} is required`);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
};

const readOptionalText = (body: Record<string, unknown>, field: string): string | undefined => {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  return value.trim();
};

const readRequiredDate = (body: Record<string, unknown>): string => {
  const value = readRequiredText(body, 'date');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !DATE_PATTERN.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ValidationError('date must be a valid YYYY-MM-DD date');
  }
  return value;
};

const readOptionalCapacity = (body: Record<string, unknown>): number | undefined => {
  const value = body.capacity;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ValidationError('capacity must be a positive integer');
  }
  return value;
};

const readOptionalFee = (body: Record<string, unknown>): number | undefined => {
  const value = body.fee;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError('fee must be a non-negative number');
  }
  return value;
};

const readOptionalMarketStatus = (body: Record<string, unknown>): MarketStatus | undefined => {
  const value = body.status;
  if (value === undefined || value === null) return undefined;
  if (!isMarketStatus(value)) {
    throw new ValidationError(`status must be one of: ${MARKET_STATUSES.join(', ')}`);
  }
  return value;
};

const readRequiredMarketStatus = (body: Record<string, unknown>): MarketStatus => {
  const status = readOptionalMarketStatus(body);
  if (status === undefined) throw new ValidationError('status is required');
  return status;
};

const readOptionalVendorStatus = (body: Record<string, unknown>): VendorStatus | undefined => {
  const value = body.status;
  if (value === undefined || value === null) return undefined;
  if (!isVendorStatus(value)) {
    throw new ValidationError(`status must be one of: ${VENDOR_STATUSES.join(', ')}`);
  }
  return value;
};

const readOptionalCheckedIn = (body: Record<string, unknown>): boolean | undefined => {
  const value = body.checkedIn;
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError('checkedIn must be a boolean');
  return value;
};

const readRequiredCompleted = (body: Record<string, unknown>): boolean => {
  const value = body.completed;
  if (value === undefined) throw new ValidationError('completed is required');
  if (typeof value !== 'boolean') throw new ValidationError('completed must be a boolean');
  return value;
};

const assertAllowedKeys = (body: Record<string, unknown>, allowed: readonly string[]): void => {
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new ValidationError(`Unexpected field(s): ${unexpected.join(', ')}`);
  }
};

const readIdParam = (req: Request): string => {
  const value: unknown = req.params.id;
  return typeof value === 'string' ? value : '';
};

const readMarketIdQuery = (req: Request): string | undefined => {
  const value: unknown = req.query.marketId;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError('marketId query parameter must be a non-empty string');
  }
  return value.trim();
};

const readErrorStatus = (error: unknown): number => {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === 'number') return candidate.status;
    if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  }
  return 500;
};

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }

  if (error instanceof NotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }

  if (error instanceof ValidationError) {
    res.status(400).json({ error: error.message });
    return;
  }

  const status = readErrorStatus(error);
  if (status >= 400 && status < 500) {
    const message = error instanceof Error && error.message ? error.message : 'Request failed';
    res.status(status).json({ error: message });
    return;
  }

  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[stallmate] Unhandled error: ${detail}`);
  res.status(500).json({ error: 'Internal server error' });
};

export const createApp = (store: MarketStore = new MarketStore()): Express => {
  const app = express();
  const distDir = path.resolve(process.cwd(), 'dist');

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'stallmate' });
  });

  app.get('/api/dashboard', (_req, res) => {
    res.status(200).json(store.dashboard());
  });

  app.get('/api/markets', (_req, res) => {
    res.status(200).json(store.listMarkets());
  });

  app.post('/api/markets', (req, res) => {
    const body = readBody(req.body);
    const market = store.createMarket({
      name: readRequiredText(body, 'name'),
      date: readRequiredDate(body),
      venue: readRequiredText(body, 'venue'),
      neighborhood: readRequiredText(body, 'neighborhood'),
      capacity: readOptionalCapacity(body),
      notes: readOptionalText(body, 'notes'),
      status: readOptionalMarketStatus(body),
    });
    res.status(201).json(market);
  });

  app.patch('/api/markets/:id', (req, res) => {
    const body = readBody(req.body);
    assertAllowedKeys(body, ['status']);
    const market = store.updateMarketStatus(readIdParam(req), readRequiredMarketStatus(body));
    res.status(200).json(market);
  });

  app.get('/api/vendors', (req, res) => {
    res.status(200).json(store.listVendors(readMarketIdQuery(req)));
  });

  app.post('/api/vendors', (req, res) => {
    const body = readBody(req.body);
    const vendor = store.createVendor({
      marketId: readRequiredText(body, 'marketId'),
      name: readRequiredText(body, 'name'),
      category: readRequiredText(body, 'category'),
      stall: readRequiredText(body, 'stall'),
      contact: readRequiredText(body, 'contact'),
      fee: readOptionalFee(body),
      status: readOptionalVendorStatus(body),
    });
    res.status(201).json(vendor);
  });

  app.patch('/api/vendors/:id', (req, res) => {
    const body = readBody(req.body);
    assertAllowedKeys(body, ['status', 'checkedIn']);
    const status = readOptionalVendorStatus(body);
    const checkedIn = readOptionalCheckedIn(body);
    if (status === undefined && checkedIn === undefined) {
      throw new ValidationError('Provide at least one of status or checkedIn');
    }
    res.status(200).json(store.updateVendor(readIdParam(req), { status, checkedIn }));
  });

  app.get('/api/tasks', (req, res) => {
    res.status(200).json(store.listTasks(readMarketIdQuery(req)));
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const body = readBody(req.body);
    assertAllowedKeys(body, ['completed']);
    const task = store.updateTaskCompletion(readIdParam(req), readRequiredCompleted(body));
    res.status(200).json(task);
  });

  app.get('/api/activity', (_req, res) => {
    res.status(200).json(store.listActivity());
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(express.static(distDir, { index: 'index.html' }));

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    const indexFile = path.join(distDir, 'index.html');
    if (!existsSync(indexFile)) {
      next();
      return;
    }
    res.sendFile(indexFile);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
};
