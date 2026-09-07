/** Minimal `.env` parser: KEY=value per line, `#` comments, optional `export ` prefix and quoted values. */
export function parseDotenv(text: string): { key: string; value: string }[] {
  const rows: { key: string; value: string }[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.replace(/^export\s+/, '');
    const eqIdx = withoutExport.indexOf('=');
    if (eqIdx === -1) continue;
    const key = withoutExport.slice(0, eqIdx).trim();
    let value = withoutExport.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    rows.push({ key, value });
  }
  return rows;
}
