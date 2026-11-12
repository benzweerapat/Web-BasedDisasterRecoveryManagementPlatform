import React from 'react';
import { formatNullable } from '../../utils/formatters';

const address = appliance => appliance?.applianceIp || appliance?.applianceHostname || null;

function ComparisonCard({ comparison, counts }) {
  const sides = comparison?.sides || [];
  const rows = [
    ['Name', item => item.applianceName],
    ['Server', item => address(item)],
    ['Version', item => item.version],
    ['Associated vCenter', item => item.associatedVcenterHost || item.associatedVcenterName]
  ];
  if (sides.some(item => item.applianceHostname && item.applianceIp && item.applianceHostname !== item.applianceIp)) {
    rows.splice(2, 0, ['Domain name', item => item.applianceHostname]);
  }

  return (
    <section className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-200">
        <h2 className="font-bold text-slate-800">{comparison.title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[650px]">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="p-3 w-1/4">Field</th>
              {sides.map(side => <th key={side.connectionId} className="p-3">{formatNullable(side.siteName)}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(([label, getter]) => (
              <tr key={label}>
                <th className="p-3 font-semibold text-slate-700 bg-slate-50/50">{label}</th>
                {sides.map(side => <td key={side.connectionId} className="p-3 text-slate-600">{getter(side) ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function ApplianceSummaryWidget({ overview }) {
  if (!overview) return null;
  const comparisons = overview.sitePairComparisons || [];
  const counts = overview.replicatedFromSiteCounts || [];
  return (
    <div className="space-y-5">
      {comparisons.map(comparison => (
        <ComparisonCard key={comparison.productType} comparison={comparison} counts={counts} />
      ))}
    </div>
  );
}
