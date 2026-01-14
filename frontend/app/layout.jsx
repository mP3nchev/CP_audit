import './globals.css';

export const metadata = {
  title: 'GDPR Auditor - Privacy & Cookie Compliance',
  description: 'Professional GDPR Privacy & Cookie Compliance Auditor Tool',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="min-h-screen bg-gray-50">
          <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
              <a href="/" className="block hover:no-underline">
                <h1 className="text-2xl font-bold text-primary-900 hover:text-primary-600 transition-colors">
                  GDPR Auditor
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  Privacy & Cookie Compliance Scanner
                </p>
              </a>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>

          <footer className="bg-white border-t border-gray-200 mt-16">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
              <p className="text-center text-sm text-gray-500">
                &copy; {new Date().getFullYear()} CraftPolicy. All rights reserved.
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
