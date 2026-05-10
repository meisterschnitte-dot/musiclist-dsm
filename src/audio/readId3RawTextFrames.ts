import { labelcodeWithLcPrefix } from "../blankframeSearch";

/**
 * Liest aus einer MP3 Roh-Texte aus ID3v2, ohne die ID3v2.3-Regel
 * „an `/` splitten“ (music-metadata `FrameParser.splitValue`).
 *
 * Betrifft u. a. TCOM/TPE1 und **TXXX** (Hersteller, Label, …): Werte wie
 * `Warner/Chappell…` würden sonst zerlegt und nur noch teilweise gemappt.
 */

const ID3_HEADER_LEN = 10;

export type Id3RawPreferredFields = Partial<
  Pick<
    import("./audioTags").AudioTags,
    "composer" | "artist" | "isrc" | "labelcode" | "label" | "hersteller" | "gvlRechte"
  >
>;

/**
 * TXXX-Beschreibungen: kanonisch wie {@link ./embedId3.ts} plus gängige Fremd-Tools
 * (z. B. „Publisher“ / „GVL Rights“ statt „Hersteller“ / „Rechterückruf“).
 * „Writer“ → Komponist (wie beim Referenz-Fremdtagging).
 */
const TXXX_DESCRIPTION_TO_KEY: Record<string, keyof Id3RawPreferredFields> = {
  Hersteller: "hersteller",
  Publisher: "hersteller",
  ISRC: "isrc",
  Labelcode: "labelcode",
  Label: "label",
  Writer: "composer",
  "Rechterückruf": "gvlRechte",
  "GVL Rights": "gvlRechte",
};

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

function decodeBuffer(bytes: Uint8Array, encStr: string): string {
  if (bytes.length === 0) return "";
  try {
    if (encStr === "latin1") return new TextDecoder("windows-1252").decode(bytes);
    if (encStr === "utf8") return new TextDecoder("utf8").decode(bytes);
    if (encStr === "utf-16be") return new TextDecoder("utf-16be").decode(bytes);
    if (encStr === "utf-16le") {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return new TextDecoder("utf-16le").decode(bytes.subarray(2));
      }
      if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        return new TextDecoder("utf-16be").decode(bytes.subarray(2));
      }
      return new TextDecoder("utf-16le").decode(bytes);
    }
    return new TextDecoder("utf8").decode(bytes);
  } catch {
    return "";
  }
}

/** Null-terminierte Beschreibung (TXXX), wie `readIdentifierAndData` in music-metadata. */
function readNullTerminatedDescription(
  bytes: Uint8Array,
  encStr: string
): { text: string; len: number } {
  if (encStr === "utf-16le" || encStr === "utf-16be") {
    let i = 0;
    while (i + 1 < bytes.length) {
      if (bytes[i] === 0 && bytes[i + 1] === 0) {
        return { text: decodeBuffer(bytes.subarray(0, i), encStr), len: i + 2 };
      }
      i += 2;
    }
    return { text: decodeBuffer(bytes, encStr), len: bytes.length };
  }
  const z = bytes.indexOf(0);
  if (z === -1) {
    return { text: decodeBuffer(bytes, encStr), len: bytes.length };
  }
  return { text: decodeBuffer(bytes.subarray(0, z), encStr), len: z + 1 };
}

/**
 * TXXX: [encoding][description \\0][value…] — Wert **ohne** splitValue an `/`.
 */
function decodeTxxxFrameRaw(payload: Uint8Array): { description: string; value: string } | undefined {
  if (payload.length < 2) return undefined;
  const { encoding: encStr } = textEncodingFromByte(payload[0]!);
  const afterEnc = payload.subarray(1);
  const desc = readNullTerminatedDescription(afterEnc, encStr);
  const valueBytes = afterEnc.subarray(desc.len);
  const value = decodeBuffer(valueBytes, encStr).replace(/\0+$/, "").trim();
  const description = desc.text.replace(/\0+$/, "").trim();
  return { description, value };
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
 * Ein Durchlauf über den ID3v2-Tag am Dateianfang: TCOM/TPE1, TOLY („Writer“-Komponisten
 * beim Referenz-Fremdtagging), TXXX mit vollständigen Strings ohne `/`-Split durch die Bibliothek.
 */
export function readId3RawPreferredTextFields(u8: Uint8Array): Id3RawPreferredFields {
  const out: Id3RawPreferredFields = {};
  /** Mehrfache TOLY-Frames eines Fremdsystems („Writer“-Spalte in Tag-Apps). */
  const tolyWriterParts: string[] = [];
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

    if (major >= 3 && idNorm === "TXXX") {
      const txxx = decodeTxxxFrameRaw(payload);
      if (!txxx) continue;
      const key = TXXX_DESCRIPTION_TO_KEY[txxx.description];
      if (!key || !txxx.value) continue;
      if (out[key] !== undefined) continue;
      out[key] = txxx.value;
      continue;
    }

    if (major >= 3 && idNorm === "TOLY") {
      const tLy = decodeId3TextInformationFrame(payload)?.trim();
      if (tLy) tolyWriterParts.push(tLy);
      continue;
    }

    const text = decodeId3TextInformationFrame(payload);
    if (!text) continue;

    if (major === 2) {
      if (idNorm === "TCM" && out.composer === undefined) out.composer = text;
      if (idNorm === "TP1" && out.artist === undefined) out.artist = text;
    } else {
      if (idNorm === "TCOM" && out.composer === undefined) out.composer = text;
      if (idNorm === "TPE1" && out.artist === undefined) out.artist = text;
      /** Standard-ID3 „Publisher“ (oft statt TXXX „Publisher“ / „Hersteller“). */
      if (idNorm === "TPUB" && out.hersteller === undefined) out.hersteller = text;
      /** Fremdsystem „LACO“ = Labelcode (z. B. LC95281 → LC 95281). */
      if (idNorm === "LACO" && out.labelcode === undefined) {
        const lc = labelcodeWithLcPrefix(text.trim());
        if (lc) out.labelcode = lc;
      }
    }
  }

  /** Mehrere TOLY („Writer“) setzen zusammen das Komponistenfeld (ersetzt einzelnes TCOM, falls gesetzt). */
  if (tolyWriterParts.length > 0) {
    out.composer = tolyWriterParts.join(", ");
  }

  if (out.labelcode?.trim()) {
    const n = labelcodeWithLcPrefix(out.labelcode.trim());
    if (n) out.labelcode = n;
  }

  return out;
}

const HEX_PREVIEW_MAX = 64;

function hexPreviewBytes(u8: Uint8Array, maxBytes = HEX_PREVIEW_MAX): string {
  const n = Math.min(u8.length, maxBytes);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(u8[i]!.toString(16).padStart(2, "0"));
  let s = parts.join(" ");
  if (u8.length > maxBytes) s += ` … (+${u8.length - maxBytes} Bytes)`;
  return s;
}

/**
 * Zeilenweise Auflistung aller ID3v2-Frames am Dateianfang (Diagnose / MP3-Analyse).
 * Komprimierte oder verschlüsselte Frames werden nur mit Roh-Hex angedeutet.
 */
export function buildRawId3v2FrameInspectionText(u8: Uint8Array): string {
  const lines: string[] = [];
  if (u8.length < ID3_HEADER_LEN) {
    return "Kein ID3v2-Kopfbereich (Datei zu kurz).";
  }

  const sig = String.fromCharCode(u8[0]!, u8[1]!, u8[2]!);
  if (sig !== "ID3") {
    return "Keine ID3v2-Signatur am Dateianfang (kein auswertbarer ID3-Block dort).";
  }

  const major = u8[3]!;
  if (major !== 2 && major !== 3 && major !== 4) {
    return `ID3-Version nicht unterstützt (major=${major}).`;
  }

  const tagBodySize = uint32Synchsafe(u8, 6);
  const bodyStart = ID3_HEADER_LEN;
  const bodyEnd = Math.min(u8.length, bodyStart + tagBodySize);
  const headerFlags = u8[5]!;
  lines.push(
    `ID3v2.${major}  deklarierte Tag-Größe: ${tagBodySize} Bytes  Header-Flags: 0x${headerFlags.toString(16)}`,
    ""
  );

  let off = bodyStart;
  const ext = (u8[5]! & 0x40) !== 0;
  if (ext) {
    if (off + 4 > bodyEnd) {
      lines.push("ID3: Extended header angekündigt, aber unvollständig.");
      return lines.join("\n");
    }
    const extSize = major === 4 ? uint32Synchsafe(u8, off) : readUInt32BE(u8, off);
    if (extSize < 4 || off + extSize > bodyEnd) {
      lines.push("ID3: Extended header ungültig.");
      return lines.join("\n");
    }
    off += extSize;
  }

  const fhLen = getFrameHeaderSize(major);
  let frameIndex = 0;

  while (off + fhLen <= bodyEnd) {
    const fh = readFrameHeader(u8, off, major);
    if (!fh) break;
    if (fh.id === "\0\0\0" || (major >= 3 && fh.id === "\0\0\0\0")) break;
    if (fh.length < 0 || off + fhLen + fh.length > bodyEnd) break;

    off += fhLen;
    const rawPayload = u8.subarray(off, off + fh.length);
    off += fh.length;

    frameIndex++;
    const idNorm = fh.id.replace(/\0/g, "").trim();
    const fmt =
      fh.major >= 3 && fh.flags
        ? ` flags[unsync=${fh.flags.format.unsynchronisation}, compr=${fh.flags.format.compression}, enc=${fh.flags.format.encryption}, dli=${fh.flags.format.data_length_indicator}]`
        : "";
    lines.push(`--- Frame #${frameIndex}  ${idNorm}  Länge=${fh.length}${fmt} ---`);

    const payload = sliceFramePayload(rawPayload, fh);
    if (payload === undefined) {
      lines.push(
        "  [Payload nicht lesbar: komprimiert oder verschlüsselt — nur Rohdaten-Hex]",
        `  ${hexPreviewBytes(rawPayload, 96)}`
      );
      continue;
    }
    if (payload.length === 0) {
      lines.push("  (leeres Payload)");
      continue;
    }

    if (major >= 3 && idNorm === "TXXX") {
      const txxx = decodeTxxxFrameRaw(payload);
      if (!txxx) {
        lines.push("  [TXXX Dekodierung fehlgeschlagen]", `  ${hexPreviewBytes(payload)}`);
      } else {
        const mapKey = TXXX_DESCRIPTION_TO_KEY[txxx.description];
        lines.push(
          `  TXXX-Beschreibung: ${JSON.stringify(txxx.description)}`,
          `  TXXX-Wert: ${JSON.stringify(txxx.value)}`,
          mapKey
            ? `  → App-Zuordnung: ${String(mapKey)}`
            : "  → App-Zuordnung: (keine feste Zuordnung)"
        );
      }
      continue;
    }

    const asText = decodeId3TextInformationFrame(payload);
    if (asText !== undefined) {
      lines.push(`  Text/Dekodiert: ${JSON.stringify(asText)}`);
      const human: Record<string, string> = {
        TCOM: "Komponist (TCOM)",
        TPE1: "Interpret (TPE1)",
        TPUB: "Publisher / Verlag (TPUB)",
        TIT2: "Titel (TIT2)",
        TALB: "Album (TALB)",
        TOLY: "TOLY (oft „Writer“ / Komponist im Fremdtag-System)",
        COMM: "Kommentar (COMM)",
        LACO: "Labelcode (Fremd-Frame) → Anzeige wie „LC …“ (z. B. LC95281 → LC 95281)",
      };
      const hint = human[idNorm];
      if (hint) lines.push(`  Bedeutung (grob): ${hint}`);
    } else {
      lines.push(`  Binär oder nicht als Text dekodierbar (${payload.length} Bytes)`, `  ${hexPreviewBytes(payload)}`);
    }
  }

  if (frameIndex === 0) lines.push("(Keine Frames gefunden oder Tag-Body leer.)");
  return lines.join("\n");
}
