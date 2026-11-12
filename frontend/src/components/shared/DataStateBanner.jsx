import SemanticIcon from "./SemanticIcon";
import React from 'react';

const COPY = {
  SUCCESS_EMPTY: ['No data', 'Collection succeeded, but this scope contains no items.', 'bg-slate-50 border-slate-200 text-slate-700'],
  STALE_WITH_DATA: ['Showing saved data', 'The latest collection failed. Showing the last known good data.', 'bg-amber-50 border-amber-200 text-amber-800'],
  PARTIAL: ['Partial data', 'Some scopes could not be loaded. Successful scopes remain available.', 'bg-orange-50 border-orange-200 text-orange-800'],
  CONTRACT_ERROR: ['Invalid data contract', 'The response does not match the supported API contract.', 'bg-red-50 border-red-200 text-red-800'],
  CANONICAL_EMPTY_WITH_OBSERVATIONS: ['Logical view is not available yet', 'Observations exist, but identity data is insufficient for the canonical view.', 'bg-amber-50 border-amber-200 text-amber-800']
};

export default function DataStateBanner() {
  return null;
}
