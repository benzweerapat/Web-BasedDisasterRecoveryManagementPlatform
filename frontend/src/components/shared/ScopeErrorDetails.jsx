import React from 'react';

export default function ScopeErrorDetails({ errors = {} }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <details className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
      <summary className="font-semibold cursor-pointer">Failed scopes ({entries.length})</summary>
      <ul className="mt-2 space-y-2 list-disc pl-5">
        {entries.map(([scope, error]) => (
          <li key={scope}>
            <span className="font-semibold">{scope}</span>: {error.safeMessage || 'Unable to load data'}
            {error.requestId && <details className="text-xs opacity-75"><summary>Technical details</summary><code>Request ID: {error.requestId}</code></details>}
          </li>
        ))}
      </ul>
    </details>
  );
}
