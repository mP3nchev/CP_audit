'use client';

import { useState } from 'react';
import StatusBadge from './StatusBadge';

export default function ResultsDisplay({ auditId }) {
  const [copied, setCopied] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const reportUrl = `${apiUrl}/api/audit/${auditId}/report`;
  const shareUrl = `${apiUrl}/api/audit/${auditId}/share`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 space-y-6">
      {/* Success Header */}
      <div className="flex items-center space-x-3">
        <div className="text-4xl">✅</div>
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Audit Completed!</h3>
          <p className="text-sm text-gray-600">Your GDPR compliance report is ready</p>
        </div>
      </div>

      {/* Audit Info */}
      <div className="bg-gray-50 rounded-lg p-4 space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">Audit ID:</span>
          <code className="text-xs bg-white px-2 py-1 rounded border border-gray-300">
            {auditId}
          </code>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium text-gray-700">Status:</span>
          <StatusBadge status="completed" />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <a
          href={reportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          <span className="mr-2">📊</span>
          View Full Report
        </a>

        <button
          onClick={copyShareLink}
          className="flex items-center justify-center w-full bg-gray-100 text-gray-900 py-3 px-6 rounded-lg font-medium hover:bg-gray-200 transition-colors"
        >
          <span className="mr-2">{copied ? '✅' : '🔗'}</span>
          {copied ? 'Link Copied!' : 'Copy Share Link'}
        </button>
      </div>

      {/* Share Link Display */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Shareable Link:
        </label>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={shareUrl}
            readOnly
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50"
          />
          <button
            onClick={copyShareLink}
            className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Report Preview */}
      <div className="border-t pt-4">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Report Preview:</h4>
        <div className="border border-gray-300 rounded-lg overflow-hidden">
          <iframe
            src={reportUrl}
            className="w-full h-96"
            title="Report Preview"
          />
        </div>
      </div>
    </div>
  );
}
