import { NextResponse } from 'next/server';

// Normalize backend URL - remove trailing slash
const BACKEND_URL = (process.env.BACKEND_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const API_KEY = process.env.INTERNAL_API_KEY;

// Validate API key exists
if (!API_KEY) {
  console.error('❌ CRITICAL: INTERNAL_API_KEY is not set!');
}

/**
 * Proxy all requests to backend with API key injected server-side.
 * This keeps the API key secure and never exposes it to the browser.
 */
export async function POST(request) {
  try {
    // Get the path from query params (e.g., /api/proxy?path=/api/audit/start)
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path') || '/api/audit/start';

    // Build backend URL (no double slashes)
    const backendUrl = `${BACKEND_URL}${path}`;
    console.log('🔄 Proxying POST to:', backendUrl);
    console.log('🔑 API Key present:', !!API_KEY);

    // Check content type to handle FormData vs JSON
    const contentType = request.headers.get('content-type') || '';
    let body;
    let headers = {
      'x-api-key': API_KEY,
    };

    if (contentType.includes('multipart/form-data')) {
      // Handle file upload (privacy policy)
      body = await request.formData();
      // Don't set Content-Type for FormData - fetch will set it with boundary
    } else {
      // Handle JSON
      const jsonBody = await request.json();
      body = JSON.stringify(jsonBody);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: headers,
      body: body,
    });

    console.log('✅ Backend response status:', response.status);

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy POST error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      backendUrl: process.env.BACKEND_API_URL,
      hasApiKey: !!API_KEY,
    });
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
    console.log('🔑 API Key present:', !!API_KEY);

    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'x-api-key': API_KEY,
      },
    });

    console.log('✅ Backend response status:', response.status);

    const data = await response.json();

    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('❌ Proxy GET error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      backendUrl: process.env.BACKEND_API_URL,
      hasApiKey: !!API_KEY,
    });
    return NextResponse.json(
      { error: 'Proxy failed', details: error.message },
      { status: 500 }
    );
  }
}
