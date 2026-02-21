import { NextResponse } from 'next/server';

/**
 * Returns the backend URL for client-side display purposes.
 * Used for showing command-line instructions to users.
 */
export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL || 'http://localhost:3001';
  return NextResponse.json({ url: backendUrl });
}
