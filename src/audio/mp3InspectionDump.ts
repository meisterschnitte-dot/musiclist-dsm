import { basenamePath } from "../tracks/sanitizeFilename";
import { readId3RawPreferredTextFields, buildRawId3v2FrameInspectionText } from "./readId3RawTextFrames";

/** Reduziert riesige Binär-Felder (z. B. APIC) für lesbare Reports. */
function formatNativeTagValue(raw: unknown, maxNestedJson = 12_000): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);

  if (raw instanceof Uint8Array) {
    return `<Binärdaten ${raw.length} Bytes>`;
  }

  if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const d = o.data;
    if (d instanceof Uint8Array) {
      const len = d.byteLength;
      const shallow = { ...o, data: `<Binärdaten ${len} Bytes (z. B. eingebettetes Cover), weggelassen>` };
      try {
        const s = JSON.stringify(shallow, null, 2);
        return s.length > maxNestedJson ? s.slice(0, maxNestedJson) + "\n… [gekürzt]" : s;
      } catch {
        return `<Objekt mit Binärfeld (${len} Bytes)>`;
      }
    }
    if (d instanceof ArrayBuffer) {
      const len = d.byteLength;
      const shallow = { ...o, data: `<Binärdaten ${len} Bytes (z. B. eingebettetes Cover), weggelassen>` };
      try {
        const s = JSON.stringify(shallow, null, 2);
        return s.length > maxNestedJson ? s.slice(0, maxNestedJson) + "\n… [gekürzt]" : s;
      } catch {
        return `<Objekt mit Binärfeld (${len} Bytes)>`;
      }
    }

    try {
      const s = JSON.stringify(raw, null, 2);
      return s.length > maxNestedJson ? s.slice(0, maxNestedJson) + "\n… [gekürzt]" : s;
    } catch {
      return String(raw);
    }
  }

  return String(raw);
}

/**
 * Ein ausführlicher Textbericht zur Diagnose eingebetteter Tags (vor allem ID3).
 * Kombination aus Bibliotheks-Parsing, Roh-ID3-Walk und der internen Zuordnung.
 */
export async function buildMp3InspectionReportText(blob: Blob, originalFilePathOrName: string): Promise<string> {
  const ab = await blob.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const displayName =
    basenamePath(originalFilePathOrName.trim()) ||
    basenamePath(blob instanceof File ? blob.name : "track.mp3") ||
    "track.mp3";

  const chunks: string[] = [];
  chunks.push("MP3-Analyse — exportiert aus DSM Musiclist");
  chunks.push(`Quelldatei: ${displayName}`);
  chunks.push(`Dateigröße: ${blob.size} Bytes`);
  chunks.push("");

  let mmFail: string | null = null;
  try {
    const { parseBuffer } = await import("music-metadata");
    const md = await parseBuffer(u8, "audio/mpeg", {
      duration: false,
      skipCovers: true,
      includeChapters: false,
    });

    chunks.push("===music-metadata===", "");
    try {
      chunks.push("-- common --", JSON.stringify(md.common, null, 2), "");
    } catch {
      chunks.push("-- common -- (Konvertierung nach JSON nicht möglich)", "");
    }

    chunks.push("-- native (alle Frames pro Parser-Bucket, sortiert wie geliefert) --", "");
    for (const [bucket, entries] of Object.entries(md.native)) {
      chunks.push(`[ ${bucket} ]`);
      let i = 0;
      for (const tag of entries) {
        i++;
        chunks.push(`  ${i}. id=${typeof tag.id === "string" ? tag.id : String(tag.id)}`);
        chunks.push(formatNativeTagValue(tag.value).split("\n").map((l) => `     ${l}`).join("\n"));
      }
      chunks.push("");
    }

    chunks.push(`format: ${JSON.stringify(md.format)}`, "");
  } catch (e) {
    mmFail = e instanceof Error ? e.message : String(e);
  }

  if (mmFail !== null) {
    chunks.push("===music-metadata===", `(Parse fehlgeschlagen — Bericht ohne diesen Teil.)`, mmFail, "");
  }

  chunks.push("===Roh-ID3v2 (Frame für Frame, App-Walk)===");
  chunks.push("");
  chunks.push(buildRawId3v2FrameInspectionText(u8));
  chunks.push("");

  chunks.push("===Bevorzugte App-Zuordnung (readId3RawPreferredTextFields)===");
  chunks.push(JSON.stringify(readId3RawPreferredTextFields(u8), null, 2));
  chunks.push("");

  chunks.push("(Ende des Berichts)");

  return chunks.join("\n");
}

/** Sicherer Dateiname für *.txt-Download ohne Pfad-/Sonderzeichen. */
export function suggestedMp3InspectionDownloadBaseName(originalFilePathOrName: string): string {
  const stem = basenamePath(originalFilePathOrName.trim()).replace(/\.mp3$/i, "") || "track";
  return stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 140) || "track";
}
