export const formatNullable = (value, fallback = 'Not available') => {
  if (value === null || value === undefined || value === '') return fallback;
  return value;
};

export const formatPercent = (value) => {
  if (value === null || value === undefined) return 'Not available';
  return `${value}%`;
};

export const formatDateTime = (dateString) => {
  if (!dateString) return 'Never';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Never';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export const formatBytes = (bytes, decimals = 2) => {
  if (bytes === null || bytes === undefined) return 'Not available';
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const formatOptional = (val, fallback = '') => val || fallback;

export const formatRelativeTime = (dateString, baseTime = new Date()) => {
  if (!dateString) return 'Never';
  const target = new Date(dateString).getTime();
  if (isNaN(target)) return 'Never';
  const now = baseTime instanceof Date ? baseTime.getTime() : (baseTime ? new Date(baseTime).getTime() : Date.now());
  const diff = now - target;
  if (diff < 0) return 'Just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export const formatDuration = (ms) => {
  if (ms === null || ms === undefined) return 'Not available';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  const h = Math.floor(m / 60);
  if (h === 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return (m % 60) > 0 ? `${h}h ${m % 60}m` : `${h}h`;
};

export const formatLastVrSync = (ms) => {
  if (ms == null) return 'Never';
  return formatDuration(ms) + ' ago';
};

export const formatError = (error) => {
  if (!error) return 'No errors';
  return String(error);
};

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export const formatSyncTimestamp = (timestamp) => {
  if (!timestamp) return { short: 'No data', full: 'No data', isToday: false };
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return { short: 'No data', full: 'No data', isToday: false };

  const now = new Date();
  const isToday = (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  const dateStr = isToday
    ? 'Today'
    : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

  const short = isToday
    ? `Today ${timeStr}`
    : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${timeStr}`;

  const full = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()} ${hours}:${minutes}:${seconds}`;

  return { short, full, isToday, dateStr, timeStr };
};