/**
 * Small helpers shared by every `/api/v1` route file — keeps response shape
 * consistent with `ServiceResponse<T>` used throughout `src/services/*`.
 */

import type { Response } from 'express';

export function ok<T>(res: Response, data: T, message?: string): void {
  res.json(message ? { success: true, data, message } : { success: true, data });
}

export function created<T>(res: Response, data: T, message?: string): void {
  res.status(201).json(message ? { success: true, data, message } : { success: true, data });
}

export function fail(res: Response, status: number, error: string): void;
export function fail(res: Response, error: string, status?: number): void;
export function fail(res: Response, a: number | string, b?: number | string): void {
  let status = 400;
  let error = 'Request failed';
  if (typeof a === 'number') {
    status = a;
    error = typeof b === 'string' ? b : 'Request failed';
  } else {
    error = a;
    status = typeof b === 'number' ? b : 400;
  }
  res.status(status).json({ success: false, data: null, error });
}

export function notFound(res: Response, what = 'Resource'): void {
  fail(res, 404, `${what} not found`);
}

export function notImplemented(res: Response, message = 'Not implemented'): void {
  fail(res, 501, message);
}
