/**
 * File attachments cannot round-trip through localStorage, so the picked `File`
 * lives here for the session while the request itself only remembers the name.
 * After a reload the row shows its filename greyed out and asks for the file again.
 */
const files = new Map<string, File>();

export function putFile(rowId: string, file: File) {
  files.set(rowId, file);
}

export function getFile(rowId: string): File | undefined {
  return files.get(rowId);
}

export function dropFile(rowId: string) {
  files.delete(rowId);
}

export function hasFile(rowId: string): boolean {
  return files.has(rowId);
}
