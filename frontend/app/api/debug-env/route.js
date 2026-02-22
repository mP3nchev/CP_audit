import { NextResponse } from 'next/server';

/**
 * Debug endpoint - shows env var STATUS (not values) for troubleshooting.
 * Remove this file after debugging is complete.
 */
export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL;
  const apiKey = process.env.INTERNAL_API_KEY;

  // Test actual connectivity to backend
  let connectivityTest = 'not attempted';
  let connectivityError = null;

  if (backendUrl) {
    try {
      const normalizedUrl = backendUrl.replace(/\/$/, '');
      const response = await fetch(`${normalizedUrl}/health`, {
        headers: { 'x-api-key': apiKey || '' },
        signal: AbortSignal.timeout(5000),
      });
      connectivityTest = `${response.status} ${response.statusText}`;
    } catch (err) {
      connectivityTest = 'FAILED';
      connectivityError = err.message;
    }
  }

  return NextResponse.json({
    env: {
      BACKEND_API_URL: backendUrl ? `SET (${backendUrl})` : 'NOT SET ❌',
      INTERNAL_API_KEY: apiKey
        ? `SET (length: ${apiKey.length})`
        : 'NOT SET ❌',
    },
    connectivity: {
      result: connectivityTest,
      error: connectivityError,
    },
    resolvedBackendUrl: backendUrl
      ? backendUrl.replace(/\/$/, '')
      : 'http://localhost:3001 (DEFAULT - NOT SET!)',
  });
}
