/** Minimale Bytes, damit die Datei als MP3 erkannt werden kann (Fake / Platzhalter). */
export function createFakeMp3Blob(): Blob {
  const header = new Uint8Array([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  return new Blob([header], { type: "audio/mpeg" });
}
