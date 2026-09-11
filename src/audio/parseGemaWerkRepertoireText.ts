import type { ParseGemaOcrResult } from "./parseGemaOcrText";

/** Zeile mit GEMA-Ice-Nummer und Rollenbezeichnung (Portal Werksuche). */
const ROLE_META_LINE = /^(\d{6,})\s+(.+)$/;

function isGemaWerkRoleMetaLine(line: string): boolean {
  const m = ROLE_META_LINE.exec(line.trim());
  if (!m) return false;
  const role = m[2].toLowerCase();
  return (
    role.includes("komponist") ||
    role.includes("textdichter") ||
    role.includes("originalverlag") ||
    role.includes("sub-verleger") ||
    role.includes("subverleger") ||
    (role.includes("verleger") && !role.includes("sub"))
  );
}

function isPlainNameLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (ROLE_META_LINE.test(t)) return false;
  if (/^\d+$/.test(t)) return false;
  return true;
}

export function looksLikeGemaWerkRepertoireText(raw: string): boolean {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return false;
  let roleHits = 0;
  for (const line of lines) {
    if (isGemaWerkRoleMetaLine(line)) roleHits++;
  }
  return roleHits >= 1;
}

/**
 * Aus GEMA-Portal Werksuche kopiert (Beteiligte / Verlage), z. B.:
 * LYNNE, BJORN → Komponist + Interpret; Sub-Verleger/-in → Label; Originalverlag → Hersteller.
 */
export function parseGemaWerkRepertoireText(raw: string): ParseGemaOcrResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const fields: ParseGemaOcrResult["fields"] = {};
  const extraCommentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = ROLE_META_LINE.exec(line);
    if (!m) continue;
    const role = m[2].toLowerCase();
    const prev = i > 0 ? lines[i - 1]! : "";
    const next = i + 1 < lines.length ? lines[i + 1]! : "";
    const prevOk = isPlainNameLine(prev);
    const nextOk = isPlainNameLine(next);

    if (role.includes("komponist") || role.includes("textdichter")) {
      const name = prevOk ? prev : nextOk ? next : "";
      if (name) {
        fields.composer = name;
        fields.artist = name;
      }
      continue;
    }
    if (role.includes("originalverlag")) {
      if (nextOk && prevOk) {
        fields.hersteller = next;
        extraCommentLines.push(`Originalverlag (Kurz): ${prev}`);
      } else if (nextOk) {
        fields.hersteller = next;
      } else if (prevOk) {
        fields.hersteller = prev;
      }
      continue;
    }
    if (role.includes("sub-verleger") || role.includes("subverleger")) {
      if (nextOk) fields.label = next;
      else if (prevOk) fields.label = prev;
    }
  }

  if (!fields.composer && lines[0] && isPlainNameLine(lines[0])) {
    fields.composer = lines[0];
    fields.artist = lines[0];
  }

  const artist = fields.artist?.trim();
  const composer = fields.composer?.trim();
  if (composer && artist && /^ARCHIVMUSIK$/i.test(artist)) {
    fields.artist = composer;
  }

  return { fields, extraCommentLines };
}
