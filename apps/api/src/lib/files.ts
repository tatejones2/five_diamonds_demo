// Untrusted upload handling for roster imports (spec §8). Files are parsed in memory and
// discarded: nothing is stored or served back, which removes the malware-distribution vector.
import { parseCsv, ROSTER_IMPORT_MAX_ROWS } from '@fd/shared';
import { readSheet } from 'read-excel-file/node';
import { ApiError } from './errors';

const MAX_UNCOMPRESSED = 5 * 1024 * 1024;

/** Sum uncompressed sizes from the ZIP central directory (zip-bomb guard, no extraction). */
export function zipUncompressedSize(buf: Buffer): number | null {
  // End of central directory record: signature 0x06054b50, within the last 64 KB + 22 bytes.
  const start = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) return null;
    total += buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return total;
}

const isZip = (b: Buffer) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;

export async function readRosterFile(filename: string, buf: Buffer): Promise<string[][]> {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') {
    if (buf.includes(0)) throw new ApiError('FILE_REJECTED', 'That file is not a text CSV file.');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    if (text.includes('�')) throw new ApiError('FILE_REJECTED', 'Save the CSV with UTF-8 encoding and try again.');
    return parseCsv(text);
  }
  if (ext === 'xlsx') {
    if (!isZip(buf)) throw new ApiError('FILE_REJECTED', "That file isn't a valid .xlsx workbook.");
    const size = zipUncompressedSize(buf);
    if (size === null || size > MAX_UNCOMPRESSED) throw new ApiError('FILE_REJECTED', 'That workbook is too large or malformed. Export the roster as CSV instead.');
    try {
      const rows = await readSheet(buf);
      return rows
        .slice(0, ROSTER_IMPORT_MAX_ROWS + 2)
        .map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString().slice(0, 10) : String(c))))
        .filter((r) => r.some((c) => c.trim() !== ''));
    } catch {
      throw new ApiError('FILE_REJECTED', "We couldn't read that workbook. Export the roster as CSV and try again.");
    }
  }
  throw new ApiError('FILE_REJECTED', 'Upload a .csv or .xlsx file.');
}
