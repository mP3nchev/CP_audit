export default function StatusBadge({ status }) {
  const statusConfig = {
    pending: { color: 'bg-gray-100 text-gray-800', label: 'Pending' },
    scanning: { color: 'bg-blue-100 text-blue-800', label: 'Scanning...' },
    analyzing: { color: 'bg-purple-100 text-purple-800', label: 'Analyzing...' },
    generating: { color: 'bg-indigo-100 text-indigo-800', label: 'Generating Report...' },
    waiting: { color: 'bg-yellow-100 text-yellow-800', label: '⏸️ Waiting for Manual Input' },
    completed: { color: 'bg-green-100 text-green-800', label: 'Completed' },
    failed: { color: 'bg-red-100 text-red-800', label: 'Failed' }
  };

  const config = statusConfig[status] || statusConfig.pending;

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${config.color}`}>
      {config.label}
    </span>
  );
}
