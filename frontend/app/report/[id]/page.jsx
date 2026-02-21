'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import LoadingSpinner from '../../components/LoadingSpinner';

export default function ReportPage() {
  const params = useParams();
  const auditId = params.id;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Normalize API URL - ensure it starts with protocol
  let apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    apiUrl = 'https://' + apiUrl;
  }

  const authHeaders = { 'x-api-key': process.env.NEXT_PUBLIC_API_KEY };
  const reportUrl = `${apiUrl}/api/audit/${auditId}/report`;

  useEffect(() => {
    // Check if report exists
    const checkReport = async () => {
      try {
        const response = await fetch(`${apiUrl}/api/audit/${auditId}/status`, { headers: authHeaders });
        const data = await response.json();

        if (!response.ok) {
          setError('Report not found');
        } else if (data.status !== 'completed') {
          setError('Report is not ready yet');
        } else {
          setLoading(false);
        }
      } catch (err) {
        setError('Failed to load report');
      }
    };

    checkReport();
  }, [auditId, apiUrl]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading report..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md text-center">
          <div className="text-4xl mb-3">❌</div>
          <h2 className="text-xl font-semibold text-red-900 mb-2">Error</h2>
          <p className="text-red-800">{error}</p>
          <a
            href="/"
            className="inline-block mt-4 text-blue-600 hover:text-blue-800 font-medium"
          >
            Go to Home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen">
      <iframe
        src={reportUrl}
        className="w-full h-full border-0"
        title="GDPR Audit Report"
      />
    </div>
  );
}
