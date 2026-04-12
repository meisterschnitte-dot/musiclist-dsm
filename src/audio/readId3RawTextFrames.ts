/**
 * Liest aus einer MP3 den Roh-Text bestimmter ID3v2-Text-Frames (TCOM, TPE1),
 * ohne die Aufteilung an `/` bzw. die spätere Zusammenfügung mit ", ".
 *
 * `music-metadata` wendet auf ID3v2.3 für TCOM/TPE1 u. a. `split('/')` an
 * (siehe FrameParser.splitValue) und mappt danach auf `common.composer`/`artist`.
 * Dadurch gehen Trennzeichen wie `//` verloren. Hier wird der Frame-Payload
 * direkt nach [encoding][text] dekodiert — wie vor dem Split.
 */

const ID3_HEADER_LEN = 10;

function uint32Synchsafe(buf: Uint8Array, off: number): number {
  return (
    (buf[off + 3]! & 0x7f) |
    ((buf[off + 2]! & 0xff) << 7) |
    ((buf[off + 1]! & 0xff) << 14) |
    ((buf[off]! & 0xff) << 21)
  );
}

function readUInt32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off]! & 0xff) << 24) |
    ((buf[off + 1]! & 0xff) << 16) |
    ((buf[off + 2]! & 0xff) << 8) |
    (buf[off + 3]! & 0xff)
  );
}

function readUInt24BE(buf: Uint8Array, off: number): number {
  return ((buf[off]! & 0xff) << 16) | ((buf[off + 1]! & 0xff) << 8) | (buf[off + 2]! & 0xff);
}

/** Entspricht TextEncodingToken in music-metadata (ID3v2). */
function textEncodingFromByte(b: number): { encoding: string; bom: boolean } {
  switch (b) {
    case 0x00:
      return { encoding: "latin1", bom: false };
    case 0x01:
      return { encoding: "utf-16le", bom: true };
    case 0x02:
      return { encoding: "utf-16be", bom: false };
    case 0x03:
      return { encoding: "utf8", bom: false };
    default:
      return { encoding: "utf8", bom: false };
  }
}

/**
 * Dekodiert einen ID3v2-Text-Frame (T* außer TXXX): [encoding byte][text…].
 * Kein split an `/` oder null.
 */
function decodeId3TextInformationFrame(payload: Uint8Array): string | undefined {
  if (payload.length < 2) return undefined;
  const { encoding, bom } = textEncodingFromByte(payload[0]!);
  let bytes = payload.subarray(1);
  if (encoding === "utf-16le" && bom && bytes.length >= 2) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) bytes = bytes.subarray(2);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      bytes = swapUtf16Bytes(bytes.subarray(2));
    }
  }
  let s: string;
  try {
    if (encoding === "latin1") {
      s = new TextDecoder("windows-1252").decode(bytes);
    } else if (encoding === "utf-16be") {
      s = new TextDecoder("utf-16be").decode(bytes);
    } else {
      s = new TextDecoder(encoding === "utf-16le" ? "utf-16le" : "utf8").decode(bytes);
    }
  } catch {
    return undefined;
  }
  s = s.replace(/\0+$/, "").trim();
  return s.length ? s : undefined;
}

function swapUtf16Bytes(u8: Uint8Array): Uint8Array {
  const out = new Uint8Array(u8.length);
  for (let i = 0; i + 1 < u8.length; i += 2) {
    out[i] = u8[i + 1]!;
    out[i + 1] = u8[i]!;
  }
  return out;
}

/** Entfernt unsynchronisation-Bytes (0x00 nach 0xFF) wie ID3v2Parser.removeUnsyncBytes. */
function removeUnsyncBytes(buf: Uint8Array): Uint8Array {
  if (buf.length < 2) return buf;
  const out = new Uint8Array(buf.length);
  let w = 0;
  let r = 0;
  while (r < buf.length) {
    if (r > 0 && buf[r - 1] === 0xff && buf[r] === 0x00) {
      r++;
      continue;
    }
    out[w++] = buf[r++]!;
  }
  return out.subarray(0, w);
}

type FrameHeader =
  | { major: 2; id: string; length: number; flags?: undefined }
  | {
      major: 3 | 4;
      id: string;
      length: number;
      flags: {
        status: unknown;
        format: {
          unsynchronisation: boolean;
          data_length_indicator: boolean;
          compression: boolean;
          encryption: boolean;
        };
      };
    };

function readFrameHeader(buf: Uint8Array, offset: number, major: number): FrameHeader | null {
  if (major === 2) {
    if (offset + 6 > buf.length) return null;
    const id = String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!);
    const length = readUInt24BE(buf, offset + 3);
    return { major: 2, id, length };
  }
  if (major === 3 || major === 4) {
    if (offset + 10 > buf.length) return null;
    const id = String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
    const len =
      major === 4
        ? uint32Synchsafe(buf, offset + 4)
        : readUInt32BE(buf, offset + 4);
    const flags = buf.subarray(offset + 8, offset + 10);
    const unsynchronisation = (flags[1]! & 0x02) !== 0;
    const data_length_indicator = (flags[1]! & 0x01) !== 0;
    const compression = (flags[1]! & 0x08) !== 0;
    const encryption = (flags[1]! & 0x04) !== 0;
    return {
      major,
      id,
      length: len,
      flags: {
        status: {},
        format: { unsynchronisation, data_length_indicator, compression, encryption },
      },
    };
  }
  return null;
}

function getFrameHeaderSize(major: number): number {
  return major === 2 ? 6 : 10;
}

function sliceFramePayload(
  raw: Uint8Array,
  fh: FrameHeader
): Uint8Array | undefined {
  if (fh.major >= 3 && fh.flags?.format.compression) return undefined;
  if (fh.major >= 3 && fh.flags?.format.encryption) return undefined;
  let data = raw;
  if (fh.major >= 3 && fh.flags?.format.unsynchronisation) {
    data = removeUnsyncBytes(data);
  }
  if (fh.major >= 3 && fh.flags?.format.data_length_indicator && data.length >= 4) {
    data = data.subarray(4);
  }
  return data;
}

/**
 * Sucht im ID3v2-Tag nach TCOM (bzw. v2.2 TCM) bzw. TPE1 (bzw. v2.2 TP1)
 * und liefert die Roh-Strings ohne `/`-Split.
 */
export function readId3RawComposerAndLeadArtist(u8: Uint8Array): {
  composer?: string;
  leadArtist?: string;
} {
  const out: { composer?: string; leadArtist?: string } = {};
  if (u8.length < ID3_HEADER_LEN) return out;

  const id = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!);
  if (id !== "ID3") return out;

  const major = u8[3]!;
  if (major !== 2 && major !== 3 && major !== 4) return out;

  const tagBodySize = uint32Synchsafe(u8, 6);
  const bodyStart = ID3_HEADER_LEN;
  const bodyEnd = Math.min(u8.length, bodyStart + tagBodySize);
  let off = bodyStart;

  const ext = (u8[5]! & 0x40) !== 0;
  if (ext) {
    if (off + 4 > bodyEnd) return out;
    const extSize = major === 4 ? uint32Synchsafe(u8, off) : readUInt32BE(u8, off);
    if (extSize < 4 || off + extSize > bodyEnd) return out;
    off += extSize;
  }

  const fhLen = getFrameHeaderSize(major);

  while (off + fhLen <= bodyEnd) {
    const fh = readFrameHeader(u8, off, major);
    if (!fh) break;
    if (fh.id === "\0\0\0" || (major >= 3 && fh.id === "\0\0\0\0")) break;
    if (fh.length <= 0 || off + fhLen + fh.length > bodyEnd) break;

    off += fhLen;
    const rawPayload = u8.subarray(off, off + fh.length);
    off += fh.length;

    const idNorm = fh.id.replace(/\0/g, "").trim();
    const payload = sliceFramePayload(rawPayload, fh);
    if (payload === undefined || payload.length === 0) continue;

    const text = decodeId3TextInformationFrame(payload);
    if (!text) continue;

    if (major === 2) {
      if (idNorm === "TCM" && out.composer === undefined) out.composer = text;
      if (idNorm === "TP1" && out.leadArtist === undefined) out.leadArtist = text;
    } else {
      if (idNorm === "TCOM" && out.composer === undefined) out.composer = text;
      if (idNorm === "TPE1" && out.leadArtist === undefined) out.leadArtist = text;
    }
  }

  return out;
}
