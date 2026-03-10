'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

/**
 * Legacy report page — redirects to React v2 report.
 * The old Handlebars HTML report has been removed.
 */
export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const auditId = params.id;

  useEffect(() => {
    router.replace(`/report-v2/${auditId}`);
  }, [auditId, router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-600">Redirecting to report...</p>
    </div>
  );
}
