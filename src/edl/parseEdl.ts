import type { EdlEvent } from "./types";

const TC_PATTERN = /\d{2}:\d{2}:\d{2}:\d{2}/g;

function parseMainLine(line: string): EdlEvent | null {
  const trimmed = line.trim();
  if (!/^\d{6}\s/.test(trimmed)) return null;

  const matches = [...trimmed.matchAll(TC_PATTERN)];
  if (matches.length < 4) return null;

  const firstIdx = matches[0].index ?? 0;
  const prefix = trimmed.slice(0, firstIdx).trimEnd();

  const m = prefix.match(/^(\d{6})\s+(.+?)\s+(A\d+)\s+([CD])(?:\s+(\d+))?\s*$/);
  if (!m) return null;

  const [, eventNum, reelRaw, track, editType, _dissolve] = m;
  const reel = reelRaw.trim();

  const [srcIn, srcOut, recIn, recOut] = [
    matches[0][0],
    matches[1][0],
    matches[2][0],
    matches[3][0],
  ];

  return {
    eventNum,
    reel,
    track,
    editType: editType as "C" | "D",
    srcIn,
    srcOut,
    recIn,
    recOut,
  };
}

function attachSourceFile(lines: string[], startIndex: number): string | undefined {
  const next = lines[startIndex + 1]?.trim();
  if (!next?.startsWith("*SOURCE FILE:")) return undefined;
  const val = next.slice("*SOURCE FILE:".length).trim();
  if (val === "(NULL)") return undefined;
  return val;
}

export function parseEdl(text: string): EdlEvent[] {
  const lines = text.split(/\r?\n/);
  const out: EdlEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("*")) continue;

    const ev = parseMainLine(line);
    if (!ev) continue;

    const sf = attachSourceFile(lines, i);
    if (sf !== undefined) ev.sourceFile = sf;

    out.push(ev);
  }

  return out;
}

export function isBlackEvent(ev: EdlEvent): boolean {
  return ev.reel === "BL" || ev.reel.startsWith("BL ");
}
