'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [apiHealth, setApiHealth] = useState(null);

  useEffect(() => {
    checkAPIHealth();
  }, []);

  const checkAPIHealth = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/health`);
      const data = await response.json();

      if (response.ok && data.status === 'ok') {
        setApiStatus('connected');
        setApiHealth(data);
      } else {
        setApiStatus('error');
      }
    } catch (error) {
      console.error('API health check failed:', error);
      setApiStatus('disconnected');
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="bg-white rounded-lg shadow-md p-8 border border-gray-200">
        <h2 className="text-3xl font-bold text-primary-900 mb-4">
          Welcome to GDPR Auditor
        </h2>
        <p className="text-lg text-gray-700 mb-6">
          Professional GDPR Privacy & Cookie Compliance auditing tool. Scan websites for
          cookie/tracking violations and analyze Privacy & Cookie Policies.
        </p>

        {/* API Status */}
        <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700">Backend API:</span>
            {apiStatus === 'checking' && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 text-gray-700">
                Checking...
              </span>
            )}
            {apiStatus === 'connected' && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                ✓ Connected
              </span>
            )}
            {apiStatus === 'disconnected' && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                ✗ Disconnected
              </span>
            )}
            {apiStatus === 'error' && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                ⚠ Error
              </span>
            )}
          </div>

          {apiHealth && (
            <div className="text-sm text-gray-600">
              <span>Database: {apiHealth.database}</span>
              <span className="mx-2">•</span>
              <span>Response: {apiHealth.responseTime}ms</span>
            </div>
          )}
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">🍪</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            Cookie Scanner
          </h3>
          <p className="text-gray-600">
            Detect all cookies, tracking requests, and violations before user consent.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">📄</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            Policy Analysis
          </h3>
          <p className="text-gray-600">
            Analyze Privacy & Cookie Policies against 37 GDPR criteria using Claude AI.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">⚖️</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            Risk Assessment
          </h3>
          <p className="text-gray-600">
            Calculate potential fines based on 1500+ real GDPR enforcement precedents.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">🎯</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            noyb Checklist
          </h3>
          <p className="text-gray-600">
            Validate cookie banners against 8 common violations identified by noyb.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">📊</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            Professional Reports
          </h3>
          <p className="text-gray-600">
            Generate interactive HTML reports with charts, tables, and actionable solutions.
          </p>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
          <div className="text-3xl mb-3">💰</div>
          <h3 className="text-xl font-semibold text-primary-900 mb-2">
            Cost Efficient
          </h3>
          <p className="text-gray-600">
            Complete audits for less than $0.15 per scan using prompt caching.
          </p>
        </div>
      </div>

      {/* Status Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">
          🚧 Phase 0: Project Setup Complete
        </h3>
        <p className="text-blue-800 mb-4">
          The foundation is ready! Backend and frontend are initialized and communicating.
        </p>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-center">
            <span className="mr-2">✅</span>
            <span>Backend Express server running on port 3001</span>
          </li>
          <li className="flex items-center">
            <span className="mr-2">✅</span>
            <span>Frontend Next.js app running on port 3000</span>
          </li>
          <li className="flex items-center">
            <span className="mr-2">✅</span>
            <span>SQLite database initialized with schema</span>
          </li>
          <li className="flex items-center">
            <span className="mr-2">✅</span>
            <span>Health endpoints operational</span>
          </li>
          <li className="flex items-center">
            <span className="mr-2">⏳</span>
            <span>Next: Phase 1 - Puppeteer Scanner</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
