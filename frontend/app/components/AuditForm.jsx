'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import FileUpload from './FileUpload';
import LoadingSpinner from './LoadingSpinner';

const auditSchema = z.object({
  websiteUrl: z.string()
    .url('Please enter a valid URL')
    .min(1, 'Website URL is required')
    .refine((url) => url.startsWith('http://') || url.startsWith('https://'), {
      message: 'URL must start with http:// or https://'
    })
});

export default function AuditForm({ onAuditComplete }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [progress, setProgress] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm({
    resolver: zodResolver(auditSchema)
  });

  const onSubmit = async (data) => {
    try {
      setIsSubmitting(true);
      setProgress('Starting audit scan...');

      // Normalize API URL - ensure it starts with protocol
      let apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
        apiUrl = 'https://' + apiUrl;
      }
      console.log('API URL:', apiUrl);
      console.log('Sending request to:', `${apiUrl}/api/audit/start`);

      // Step 1: Start audit
      const startResponse = await fetch(`${apiUrl}/api/audit/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_url: data.websiteUrl })
      });

      console.log('Response status:', startResponse.status);
      console.log('Response headers:', Object.fromEntries(startResponse.headers.entries()));

      // Read response body once
      const responseText = await startResponse.text();
      console.log('Response body:', responseText);

      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse response as JSON:', parseError);
        throw new Error('Server returned invalid response. Please check if backend is running correctly.');
      }

      if (!startResponse.ok) {
        throw new Error(responseData.error || `Server error: ${startResponse.status}`);
      }

      const auditId = responseData.audit_id || responseData.auditId;
      console.log('Audit started:', auditId);

      // Step 2: Upload privacy policy if provided
      if (selectedFile) {
        setProgress('Uploading privacy policy...');
        const formData = new FormData();
        formData.append('privacyPolicy', selectedFile);

        const uploadResponse = await fetch(`${apiUrl}/api/audit/${auditId}/privacy-policy`, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          console.warn('Privacy policy upload failed, continuing without it');
        } else {
          console.log('Privacy policy uploaded successfully');
        }
      }

      // Step 3: Poll for completion
      setProgress('Scanning website...');
      const result = await pollAuditStatus(auditId, apiUrl);

      // Reset form
      reset();
      setSelectedFile(null);
      setProgress('');

      // Call completion callback
      if (onAuditComplete) {
        onAuditComplete(result);
      }

    } catch (error) {
      console.error('Audit failed:', error);
      alert(`Audit failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
      setProgress('');
    }
  };

  const pollAuditStatus = async (auditId, apiUrl) => {
    const HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard timeout
    const STALL_TIMEOUT_MS = 90 * 1000;   // 90 seconds stall detection
    const MAX_BACKOFF_MS = 5000;           // Cap backoff at 5 seconds

    const startTime = Date.now();
    let attempts = 0;
    let currentBackoff = 1000; // Start with 1 second

    // Stall detection state
    let lastState = null;
    let lastProgress = null;
    let lastChangeTime = Date.now();

    while (true) {
      // Termination condition 3: Hard timeout (5 minutes safety net)
      if (Date.now() - startTime > HARD_TIMEOUT_MS) {
        throw new Error('Audit timeout after 5 minutes - please try again');
      }

      try {
        const statusResponse = await fetch(`${apiUrl}/api/audit/${auditId}/status`);
        const statusData = await statusResponse.json();

        // Termination condition 1a: State is DONE
        if (statusData.state === 'DONE' || statusData.status === 'completed') {
          setProgress('Audit completed! Loading results...');
          return { auditId, status: 'completed' };
        }

        // Termination condition 1b: State is FAILED
        if (statusData.state === 'FAILED' || statusData.status === 'failed') {
          const errorMsg = statusData.error_message || statusData.error || 'Unknown error';
          throw new Error('Audit failed: ' + errorMsg);
        }

        // Termination condition 1c: State is WAITING_MANUAL_CONSENT
        if (statusData.state === 'WAITING_MANUAL_CONSENT') {
          return {
            auditId,
            status: 'waiting_manual_consent',
            websiteUrl: statusData.websiteUrl || data.websiteUrl,
            instructions: statusData.instructions
          };
        }

        // Termination condition 2: Stall detection
        // Check if state OR progress has changed
        const stateChanged = statusData.state !== lastState;
        const progressChanged = statusData.progress !== lastProgress;

        if (stateChanged || progressChanged) {
          // Progress detected, reset stall timer
          lastState = statusData.state;
          lastProgress = statusData.progress;
          lastChangeTime = Date.now();
        } else {
          // No progress, check for stall
          const stallDuration = Date.now() - lastChangeTime;
          if (stallDuration > STALL_TIMEOUT_MS) {
            throw new Error(`Audit appears stalled (no progress for ${Math.round(stallDuration / 1000)}s) - backend may be stuck`);
          }
        }

        // Update progress message
        if (statusData.metadata && statusData.metadata.currentOperation) {
          const eta = statusData.estimatedTimeRemaining
            ? ` (~${statusData.estimatedTimeRemaining}s remaining)`
            : '';
          setProgress(`[${statusData.progress}%] ${statusData.metadata.currentOperation}${eta}`);
        } else if (statusData.state) {
          const stateMessages = {
            'INIT': 'Initializing audit...',
            'SCANNING': 'Scanning website and detecting cookies...',
            'SCREENSHOTS': 'Capturing screenshots...',
            'UPLOADING': 'Uploading screenshots...',
            'SIMULATION': 'Running consent simulation...',
            'SCORING': 'Calculating compliance score...'
          };
          setProgress(stateMessages[statusData.state] || `Processing (${statusData.state})...`);
        }

      } catch (error) {
        // Network errors - don't count as stall, just retry
        console.warn('Polling error:', error.message);
      }

      // Exponential backoff: 1s → 2s → 3s → 5s (cap at 5s)
      await new Promise(resolve => setTimeout(resolve, currentBackoff));

      // Increase backoff exponentially, but cap at MAX_BACKOFF_MS
      currentBackoff = Math.min(currentBackoff + 1000, MAX_BACKOFF_MS);
      attempts++;
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Website URL Input */}
      <div>
        <label htmlFor="websiteUrl" className="block text-sm font-medium text-gray-700 mb-2">
          Website URL *
        </label>
        <input
          id="websiteUrl"
          type="text"
          placeholder="https://example.com"
          disabled={isSubmitting}
          {...register('websiteUrl')}
          className={`
            w-full px-4 py-3 border rounded-lg
            focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:bg-gray-100 disabled:cursor-not-allowed
            ${errors.websiteUrl ? 'border-red-500' : 'border-gray-300'}
          `}
        />
        {errors.websiteUrl && (
          <p className="mt-1 text-sm text-red-600">{errors.websiteUrl.message}</p>
        )}
      </div>

      {/* File Upload */}
      <FileUpload
        onFileSelect={setSelectedFile}
        accept=".txt,.pdf,.html"
        label="Privacy Policy (Optional)"
      />

      {/* Submit Button */}
      <div>
        {isSubmitting ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <LoadingSpinner size="lg" text={progress} />
          </div>
        ) : (
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Start GDPR Audit
          </button>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-900 mb-2">What we'll scan:</h4>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• All cookies and tracking technologies</li>
          <li>• Tracking before consent violations</li>
          <li>• Cookie banner compliance (noyb checklist)</li>
          <li>• Privacy Policy completeness (37 GDPR criteria)</li>
          <li>• Risk assessment and potential fines</li>
        </ul>
      </div>
    </form>
  );
}
