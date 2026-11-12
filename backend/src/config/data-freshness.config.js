const positiveSeconds = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
};

const DATA_FRESHNESS_WARNING_SECONDS = positiveSeconds(
  process.env.DATA_FRESHNESS_WARNING_SECONDS,
  60 * 60
);

const DATA_FRESHNESS_CRITICAL_SECONDS = Math.max(
  positiveSeconds(
    process.env.DATA_FRESHNESS_CRITICAL_SECONDS,
    24 * 60 * 60
  ),
  DATA_FRESHNESS_WARNING_SECONDS
);

module.exports = {
  DATA_FRESHNESS_WARNING_SECONDS,
  DATA_FRESHNESS_CRITICAL_SECONDS
};