import type { SentRequest } from '@/types';

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** cURL for a request as it was actually sent — after auth/vars were resolved. */
export function toCurl(sent: SentRequest, options: { multiline?: boolean } = {}): string {
  const sep = options.multiline ? ' \\\n  ' : ' ';
  const parts = [`curl ${shQuote(sent.url)}`];
  if (sent.method !== 'GET') parts.push(`-X ${sent.method}`);
  for (const [name, value] of sent.headers) parts.push(`-H ${shQuote(`${name}: ${value}`)}`);
  if (sent.bodyText) parts.push(`--data-raw ${shQuote(sent.bodyText)}`);
  return parts.join(sep);
}
