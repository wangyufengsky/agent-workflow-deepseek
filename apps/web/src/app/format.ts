/** Date/number formatting used by the shell pages. Pure functions, no colour. */

export function formatRelativeTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '—';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '—';
  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${String(Math.floor(diff / minute))} 分钟前`;
  if (diff < day) return `${String(Math.floor(diff / hour))} 小时前`;
  if (diff < 7 * day) return `${String(Math.floor(diff / day))} 天前`;
  return formatDateTime(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatAbsoluteTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value.length === 0) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

/** "已运行 2 小时 13 分钟" style label for service uptime. */
export function formatSince(startedAt: string | null | undefined): string {
  if (startedAt === null || startedAt === undefined || startedAt.length === 0) return '—';
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - start) / 60_000));
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${String(minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest === 0 ? `${String(hours)} 小时` : `${String(hours)} 小时 ${String(rest)} 分钟`;
  const days = Math.floor(hours / 24);
  return `${String(days)} 天 ${String(hours % 24)} 小时`;
}
