import { NextResponse } from 'next/server';

/**
 * Proxy all requests to backend with API key injected server-side.
 * Env vars are read inside handlers (not at module level) to avoid
 * stale values from build-time caching in Next.js serverless functions.
 */
export async function POST(request) {
  const BACKEND_URL = (process.env.BACKEND_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const API_KEY = process.env.INTERNAL_API_KEY;

  if (!API_KEY) {
    console.error('❌ CRITICAL: INTERNAL_API_KEY is not set!');
    return NextResponse.json({ error: 'Server misconfigured', code: 'E500' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/api/audit/start';

    const backendUrl = `${BACKEND_URL}${path}`;
    console.log('🔄 Proxying POST to:', backendUrl);

    const contentType = request.headers.get('content-type') || '';
    let body;
    let headers = { 'x-api-key': API_KEY };

    if (contentType.includes('multipart/form-data')) {
      body = await request.formData();
    } else {
      const jsonBody = await request.json();
      body = JSON.stringify(jsonBody);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(backendUrl, { method: 'POST', headers, body });

    console.log('✅ Backend response status:', response.status);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy POST error:', error.message);
    return NextResponse.json({ error: 'Proxy failed', details: error.message }, { status: 500 });
  }
}

export async function GET(request) {
  const BACKEND_URL = (process.env.BACKEND_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  const API_KEY = process.env.INTERNAL_API_KEY;

  if (!API_KEY) {
    console.error('❌ CRITICAL: INTERNAL_API_KEY is not set!');
    return NextResponse.json({ error: 'Server misconfigured', code: 'E500' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/health';

    const backendUrl = `${BACKEND_URL}${path}`;
    console.log('🔄 Proxying GET to:', backendUrl);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { 'x-api-key': API_KEY },
    });

    console.log('✅ Backend response status:', response.status);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy GET error:', error.message);
    return NextResponse.json({ error: 'Proxy failed', details: error.message }, { status: 500 });
  }
}
