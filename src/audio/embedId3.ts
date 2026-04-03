import { ID3Writer } from "browser-id3-writer";
import type { AudioTags } from "./audioTags";
import { hasAnyAudioTagValue, tagsForId3Embedding } from "./audioTags";

export async function embedId3InMp3Blob(blob: Blob, tags: AudioTags): Promise<Blob> {
  const t = tagsForId3Embedding(tags);
  if (!hasAnyAudioTagValue(t)) return blob;

  const raw = await blob.arrayBuffer();
  const writer = new ID3Writer(raw);

  if (t.songTitle?.trim()) writer.setFrame("TIT2", t.songTitle.trim());
  if (t.artist?.trim()) writer.setFrame("TPE1", [t.artist.trim()]);
  if (t.album?.trim()) writer.setFrame("TALB", t.album.trim());
  if (t.year?.trim()) (writer as any).setFrame("TYER", t.year.trim());
  if (t.composer?.trim()) writer.setFrame("TCOM", [t.composer.trim()]);
  if (t.comment?.trim()) {
    writer.setFrame("COMM", {
      language: "deu",
      description: "",
      text: t.comment.trim(),
    });
  }

  if (t.isrc?.trim()) {
    writer.setFrame("TXXX", { description: "ISRC", value: t.isrc.trim() });
  }

  if (t.labelcode?.trim()) {
    writer.setFrame("TXXX", { description: "Labelcode", value: t.labelcode.trim() });
  }
  if (t.label?.trim()) {
    writer.setFrame("TXXX", { description: "Label", value: t.label.trim() });
  }
  if (t.hersteller?.trim()) {
    writer.setFrame("TXXX", { description: "Hersteller", value: t.hersteller.trim() });
  }
  if (t.gvlRechte?.trim()) {
    writer.setFrame("TXXX", { description: "Rechterückruf", value: t.gvlRechte.trim() });
  }

  writer.addTag();
  return writer.getBlob();
}
