import fs from "node:fs/promises";

const SCAN_WINDOW = 64 * 1024;

export type PlayerAudioProbe = { ok: true } | { ok: false; reason: string };

function id3BodyOffset(head: Buffer): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  const size =
    ((head[6]! & 0x7f) << 21) | ((head[7]! & 0x7f) << 14) | ((head[8]! & 0x7f) << 7) | (head[9]! & 0x7f);
  return 10 + size;
}

function isMpegAudioFrame(b0: number, b1: number, b2: number): boolean {
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return false;
  const version = (b1 >> 3) & 0x3;
  const layer = (b1 >> 1) & 0x3;
  if (version === 1 || layer === 0) return false;
  const bitrate = (b2 >> 4) & 0xf;
  const sample = (b2 >> 2) & 0x3;
  return bitrate !== 0x0 && bitrate !== 0xf && sample !== 0x3;
}

function hasMpegFrame(buf: Buffer): boolean {
  const end = buf.length - 2;
  for (let i = 0; i < end; i++) {
    if (isMpegAudioFrame(buf[i]!, buf[i + 1]!, buf[i + 2]!)) return true;
  }
  return false;
}

function asciiAt(buf: Buffer, offset: number, text: string): boolean {
  if (offset + text.length > buf.length) return false;
  return buf.subarray(offset, offset + text.length).toString("latin1") === text;
}

function looksLikeWav(buf: Buffer): boolean {
  return asciiAt(buf, 0, "RIFF") && asciiAt(buf, 8, "WAVE");
}

function looksLikeFlac(buf: Buffer): boolean {
  return asciiAt(buf, 0, "fLaC");
}

function looksLikeOgg(buf: Buffer): boolean {
  return asciiAt(buf, 0, "OggS");
}

function looksLikeMp4(buf: Buffer): boolean {
  if (buf.length < 12 || !asciiAt(buf, 4, "ftyp")) return false;
  const brand = buf.subarray(8, 12).toString("latin1");
  return /^(M4A[ C]|M4B[ C]|mp4[12]|isom|iso[2-6]|avc1|dash|mp41|mp42)/.test(brand);
}

function looksLikeKnownContainer(buf: Buffer): boolean {
  return looksLikeWav(buf) || looksLikeFlac(buf) || looksLikeOgg(buf) || looksLikeMp4(buf);
}

export async function probePlayableAudio(abs: string): Promise<PlayerAudioProbe> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(abs, "r");
    const st = await fh.stat();
    if (st.size < 16) return { ok: false, reason: "Datei ist zu klein für Audio." };
    const head = Buffer.alloc(Math.min(32, st.size));
    await fh.read(head, 0, head.length, 0);
    if (looksLikeKnownContainer(head)) return { ok: true };
    const audioOff = id3BodyOffset(head);
    if (audioOff >= st.size) {
      return { ok: false, reason: "Keine gültigen Audiodaten — Datei ist nicht abspielbar." };
    }
    const n = Math.min(SCAN_WINDOW, st.size - audioOff);
    if (n < 4) return { ok: false, reason: "Keine gültigen Audiodaten — Datei ist nicht abspielbar." };
    const win = Buffer.alloc(n);
    await fh.read(win, 0, n, audioOff);
    if (looksLikeKnownContainer(win) || hasMpegFrame(win)) return { ok: true };
    return { ok: false, reason: "Keine gültigen Audiodaten — Datei ist nicht abspielbar." };
  } catch {
    return { ok: false, reason: "Datei nicht lesbar." };
  } finally {
    await fh?.close();
  }
}
