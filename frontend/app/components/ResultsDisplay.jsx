'use client';

import { useState, useEffect } from 'react';
import StatusBadge from './StatusBadge';
import LoadingSpinner from './LoadingSpinner';

export default function ResultsDisplay({ auditId, status, websiteUrl, instructions }) {
  const [copied, setCopied] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [pollingForCompletion, setPollingForCompletion] = useState(false);
  const [backendUrl, setBackendUrl] = useState('http://localhost:3001');

  // Fetch backend URL for command display
  useEffect(() => {
    fetch('/api/backend-url')
      .then(res => res.json())
      .then(data => setBackendUrl(data.url))
      .catch(err => console.error('Failed to fetch backend URL:', err));
  }, []);

  const reportUrl = `https://cp-audit.vercel.app/report-v2/${auditId}`;
  const [shareUrl, setShareUrl] = useState(reportUrl);

  const copyShareLink = async () => {
    // Fetch shareable link on first copy if not already fetched
    if (shareUrl === reportUrl) {
      try {
        const res = await fetch(`/api/proxy?path=/api/audit/${auditId}/share`);
        if (res.ok) {
          const data = await res.json();
          if (data.share_url) {
            setShareUrl(data.share_url);
            navigator.clipboard.writeText(data.share_url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            return;
          }
        }
      } catch (e) {
        console.error('Failed to fetch share link:', e);
      }
    }
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

      const resumeResponse = await fetch(`/api/proxy?path=/api/audit/${auditId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!resumeResponse.ok) {
        const errorData = await resumeResponse.json();
        throw new Error(errorData.error || 'Failed to resume audit');
      }

      const result = await resumeResponse.json();
      console.log('✅ Resume response:', result);

      // Start polling - keep showing pause screen with "Resuming..." message
      setPollingForCompletion(true);
      pollForCompletion();

    } catch (error) {
      alert(`Failed to resume audit: ${error.message}`);
      setIsResuming(false);
    }
  };

  const pollForCompletion = async () => {
    console.log('⏳ Starting polling for audit completion...');
    const MAX_POLLS = 60; // 60 polls * 2s = 2 minutes max
    let attempts = 0;

    const poll = async () => {
      try {
        const statusResponse = await fetch(`/api/proxy?path=/api/audit/${auditId}/status`);
        const statusData = await statusResponse.json();

        console.log(`📡 Poll #${attempts + 1}: status=${statusData.status}, state=${statusData.state}`);

        if (statusData.status === 'completed' || statusData.state === 'DONE') {
          console.log('✅ Audit completed! Redirecting to show report...');
          // Redirect with URL params to preserve audit ID after reload
          window.location.href = `/?audit=${auditId}&status=completed`;
          return;
        }

        if (statusData.status === 'failed' || statusData.state === 'FAILED') {
          console.error('❌ Audit failed:', statusData.error_message);
          alert('Audit failed: ' + (statusData.error_message || 'Unknown error'));
          setIsResuming(false);
          return;
        }

        // Continue polling
        attempts++;
        if (attempts < MAX_POLLS) {
          setTimeout(poll, 2000); // Poll every 2 seconds
        } else {
          console.error('⏰ Polling timeout after', attempts, 'attempts');
          alert('Polling timeout. Please refresh the page to check audit status.');
          setIsResuming(false);
        }

      } catch (error) {
        console.error('❌ Polling error:', error);
        attempts++;
        if (attempts < MAX_POLLS) {
          setTimeout(poll, 2000);
        } else {
          setIsResuming(false);
        }
      }
    };

    poll();
  };

  // Show waiting state for manual consent
  if (status === 'waiting_manual_consent' && !resumed) {
    // If polling for completion, show loading state
    if (pollingForCompletion) {
      return (
        <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 space-y-6">
          <div className="flex items-center space-x-3">
            <div className="text-4xl">⏳</div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Resuming Audit...</h3>
              <p className="text-sm text-gray-600">Step 17 is running (compliance score calculation)</p>
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <LoadingSpinner size="lg" text="Polling for completion... This should take 30-60 seconds." />
          </div>
          <div className="text-xs text-gray-500 text-center">
            The page will automatically reload when the audit is complete.
          </div>
        </div>
      );
    }

    // Use the backend URL fetched from the server
    const commandLine = `node manual-consent-audit.js --url "${websiteUrl}" --audit-id ${auditId} --api-url ${backendUrl}`;

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
            <li>Open <strong>Git Bash</strong> (NOT regular CMD) on your <strong>LOCAL machine</strong> (Windows/Mac/Linux with GUI)</li>
            <li>Navigate to your project folder. Example: <code className="bg-yellow-100 px-1 rounded">cd C:/Users/pench/Downloads/CP_audit/backend</code></li>
            <li className="ml-6 text-xs text-yellow-700">⚠️ Replace <code>C:/Users/pench</code> with your actual user path if different</li>
            <li className="ml-6 text-xs text-yellow-700">💡 Tip: Use forward slashes (/) not backslashes (\) in Git Bash</li>
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
