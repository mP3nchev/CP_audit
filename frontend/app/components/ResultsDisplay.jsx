'use client';

import { useState } from 'react';
import StatusBadge from './StatusBadge';
import LoadingSpinner from './LoadingSpinner';

export default function ResultsDisplay({ auditId, status, websiteUrl, instructions }) {
  const [copied, setCopied] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [resumed, setResumed] = useState(false);

  // Normalize API URL - ensure it starts with protocol
  let apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    apiUrl = 'https://' + apiUrl;
  }

  const reportUrl = `${apiUrl}/api/audit/${auditId}/report`;
  const shareUrl = `${apiUrl}/api/audit/${auditId}/share`;

  const copyShareLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyInstructions = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleResume = async () => {
    try {
      setIsResuming(true);

      const resumeResponse = await fetch(`${apiUrl}/api/audit/${auditId}/resume`, {
        method: 'POST'
      });

      if (!resumeResponse.ok) {
        const errorData = await resumeResponse.json();
        throw new Error(errorData.error || 'Failed to resume audit');
      }

      const result = await resumeResponse.json();

      if (result.status === 'completed' || result.state === 'DONE') {
        setResumed(true);
        // Reload page to show completed audit
        window.location.reload();
      } else {
        alert('Audit resumed but not completed yet. Please wait and try again.');
      }
    } catch (error) {
      alert(`Failed to resume audit: ${error.message}`);
    } finally {
      setIsResuming(false);
    }
  };

  // Show waiting state for manual consent
  if (status === 'waiting_manual_consent' && !resumed) {
    // Determine the correct API URL for the command
    // If we're on Vercel, use Railway backend URL
    // If we're on localhost, use localhost
    const railwayBackendUrl = process.env.NEXT_PUBLIC_API_URL && process.env.NEXT_PUBLIC_API_URL.includes('vercel')
      ? 'https://cpaudit-production.up.railway.app'
      : apiUrl;

    const commandLine = `node manual-consent-audit.js --url "${websiteUrl}" --audit-id ${auditId} --api-url ${railwayBackendUrl}`;

    return (
      <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 space-y-6">
        {/* Waiting Header */}
        <div className="flex items-center space-x-3">
          <div className="text-4xl">⏸️</div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Manual Consent Simulation Required</h3>
            <p className="text-sm text-gray-600">Step 16 requires local execution with GUI</p>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
          <h4 className="font-semibold text-yellow-900">📋 Instructions:</h4>
          <ol className="text-sm text-yellow-800 space-y-2 list-decimal list-inside">
            <li>Open a terminal on your <strong>LOCAL machine</strong> (Windows/Mac/Linux with GUI)</li>
            <li>Navigate to the backend folder: <code className="bg-yellow-100 px-1 rounded">cd backend/</code></li>
            <li>Run the command below to start the manual consent simulation</li>
            <li>A visible Chrome window will open - interact with the cookie banner as instructed</li>
            <li>After completing both Reject + Accept scenarios, click <strong>"Resume Audit"</strong> below</li>
          </ol>
        </div>

        {/* Command to Copy */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Command to run locally:
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={commandLine}
              readOnly
              className="flex-1 px-3 py-2 text-sm font-mono border border-gray-300 rounded-lg bg-gray-50"
            />
            <button
              onClick={() => copyInstructions(commandLine)}
              className="px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100"
            >
              {copied ? '✅ Copied' : 'Copy'}
            </button>
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
            <span className="text-sm font-medium text-gray-700">Website:</span>
            <span className="text-xs text-gray-600">{websiteUrl}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">Status:</span>
            <StatusBadge status="waiting" />
          </div>
        </div>

        {/* Resume Button */}
        <button
          onClick={handleResume}
          disabled={isResuming}
          className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {isResuming ? (
            <>
              <LoadingSpinner size="sm" />
              <span className="ml-2">Checking & Resuming...</span>
            </>
          ) : (
            <>
              <span className="mr-2">▶️</span>
              I've Uploaded Data - Resume Audit
            </>
          )}
        </button>

        {/* Help Text */}
        <div className="text-xs text-gray-500 text-center">
          The audit will resume from Step 17 after you upload the manual consent simulation data.
        </div>
      </div>
    );
  }

  // Show completed state
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
