import type { Request } from 'express';
import { env } from '../config/env.js';

/**
 * Resolve the frontend origin for generating invite / redirect URLs.
 * Prefers the incoming request's Origin or forwarded host (so Vercel
 * production and preview URLs work automatically), then falls back to
 * APP_URL / first configured CORS_ORIGIN, and finally localhost:5173.
 */
export function resolveClientOrigin(req: Request): string {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (originHeader && /^https?:\/\//i.test(originHeader)) {
    return originHeader.replace(/\/+$/, '');
  }

  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : '';
  const hostHeader = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');
  if (hostHeader && !/^localhost(?::3001)?$/i.test(hostHeader)) {
    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
      ? req.headers['x-forwarded-proto'].split(',')[0].trim()
      : '';
    const proto = forwardedProto || (hostHeader.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${hostHeader}`.replace(/\/+$/, '');
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\//i.test(appUrl)) {
    return appUrl.replace(/\/+$/, '');
  }

  const firstCors = (env.corsOrigin || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => /^https?:\/\//i.test(s));
  if (firstCors) {
    return firstCors.replace(/\/+$/, '');
  }

  return 'http://localhost:5173';
}
