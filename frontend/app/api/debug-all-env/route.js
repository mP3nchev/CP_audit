import { NextResponse } from 'next/server';

/**
 * TEMPORARY DEBUG - Lists ALL env var NAMES (not values) available at runtime
 * DELETE THIS FILE after debugging
 */
export async function GET() {
  const allEnvNames = Object.keys(process.env).sort();

  // Filter to show only our vars + some Vercel vars
  const relevant = allEnvNames.filter(name =>
    name.includes('API') ||
    name.includes('INTERNAL') ||
    name.includes('BACKEND') ||
    name.startsWith('VERCEL_') ||
    name.startsWith('NEXT_')
  );

  return NextResponse.json({
    total: allEnvNames.length,
    relevant: relevant,
    hasInternalApiKey: allEnvNames.includes('INTERNAL_API_KEY'),
    // Show exact matches with potential invisible chars
    exactMatches: allEnvNames.filter(n => n.toLowerCase().includes('internal')),
  });
}
