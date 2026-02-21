import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3001';
const API_KEY = process.env.INTERNAL_API_KEY; // Server-side only, NOT NEXT_PUBLIC_

/**
 * Proxy all requests to backend with API key injected server-side.
 * This keeps the API key secure and never exposes it to the browser.
 */
export async function POST(request) {
  try {
    // Get the path from query params (e.g., /api/proxy?path=/api/audit/start)
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/api/audit/start';

    // Get the body
    const body = await request.json();

    // Forward to backend with API key
    const backendUrl = `${BACKEND_URL}${path}`;
    console.log('🔄 Proxying POST to:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy error:', error);
    return NextResponse.json(
      { error: 'Proxy failed', details: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/health';

    const backendUrl = `${BACKEND_URL}${path}`;
    console.log('🔄 Proxying GET to:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
      },
    });

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy error:', error);
    return NextResponse.json(
      { error: 'Proxy failed', details: error.message },
      { status: 500 }
    );
  }
}
