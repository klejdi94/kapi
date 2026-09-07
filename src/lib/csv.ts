/**
 * Minimal RFC4180-ish CSV parser for runner data files — quoted fields,
 * escaped quotes ("") and both \n and \r\n line endings. No streaming: data
 * files for a local test runner are small enough to hold in memory whole.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const normalized = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field || row.length) pushRow();

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  if (!nonEmpty.length) return [];
  const [header, ...body] = nonEmpty;
  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, i) => {
      if (name.trim()) record[name.trim()] = cells[i] ?? '';
    });
    return record;
  });
}
