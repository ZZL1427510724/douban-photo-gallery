// zip.js — minimal ZIP writer using only built-in Web APIs.
// No dependencies. Entries are stored (method 0, no compression) so the
// writer is short, deterministic, and cannot produce a corrupt deflate
// stream. Stored ZIPs are valid ZIPs and open in macOS Archive Utility,
// Windows Explorer, unzip, Python zipfile, etc.
//
// Two bugs this file exists to prevent (both hit the earlier build):
//   1. DOS timestamps must be REAL dates. A zero/invalid timestamp
//      (1980-00-00) makes macOS Archive Utility refuse to open the file.
//      Every entry here gets the current date/time.
//   2. The response must be a real ZIP: Content-Type application/zip,
//      filename ending in .zip, and the first bytes must be "PK\x03\x04".
//      The Worker verifies the magic bytes before returning (see index.js).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  // DOS date: bits 0-4 day (1-31), 5-8 month (1-12), 9-15 year-1980.
  // DOS time: bits 0-4 seconds/2, 5-10 minutes, 11-15 hours.
  // Clamp to the valid DOS range so the timestamp can never be 1980-00-00.
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | (date.getMonth() + 1) << 5 | date.getDate();
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

/**
 * Build a ZIP archive from [{name, data: Uint8Array}].
 * Returns a Blob of type application/zip.
 */
export function createZip(entries) {
  const now = new Date();
  const { dosDate, dosTime } = dosDateTime(now);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  const enc = new TextEncoder();
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature "PK\x03\x04"
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: UTF-8 filenames
    local.setUint16(8, 0, true); // method: stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    localParts.push(local.buffer, nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // central directory signature "PK\x01\x02"
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0x0800, true); // flags: UTF-8
    central.setUint16(10, 0, true); // method: stored
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, offset, true); // local header offset
    centralParts.push(central.buffer, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = centralParts.reduce(
    (n, p) => n + (p.byteLength ?? p.length),
    0,
  );
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory "PK\x05\x06"
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, end.buffer], {
    type: "application/zip",
  });
}

/** "001-2891618628.jpg" — 3-digit sequence + photo id + real extension. */
export function zipEntryName(photo, indexInBatch, batchStart) {
  const seq = batchStart + indexInBatch + 1;
  const url = photo.original || photo.large || "";
  const m = url.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  const ext = m ? `.${m[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
  return `${String(seq).padStart(3, "0")}-${photo.id}${ext}`;
}
