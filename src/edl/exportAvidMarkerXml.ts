import type { AudioTags } from "../audio/audioTags";
import {
  AUDIO_TAG_FIELD_LABELS,
  AUDIO_TAG_TABLE_COLUMN_KEYS,
  warnungEffective,
} from "../audio/audioTags";
import { basenamePath } from "../tracks/sanitizeFilename";
import type { PlaylistEntry } from "./types";
import { DEFAULT_FPS, framesToTimecode } from "./timecode";

/**
 * Liefert einen Anzeigetext: nicht-leere Tag-Felder in Tabellenreihenfolge, mit " - " verknüpft.
 * Bei gesetzter Warnung (R3/ manuell) zuerst „Warnung: ja“.
 */
export function buildAvidMarkerCommentText(merged: AudioTags): string {
  const parts: string[] = [];
  if (merged.warnung === true) {
    parts.push("Warnung: ja");
  }
  for (const k of AUDIO_TAG_TABLE_COLUMN_KEYS) {
    const v = typeof merged[k] === "string" ? merged[k]!.trim() : "";
    if (v) parts.push(`${AUDIO_TAG_FIELD_LABELS[k]}: ${v}`);
  }
  return parts.join(" - ");
}

/** PCDATA in Avid StringAttribute: &, <, >. */
function escapeAvidStringAttributeValue(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, " ");
}

/**
 * Muster wie Avid-Export: 060a2b34…-000000-…-…-…
 * (Längen an Referenz-Datei angeglichen; pro Marker eindeutig.)
 */
function generateCrmId(): string {
  const bytes = (n: number) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  return `060a2b340101010501010f1013-000000-${bytes(8)}-${bytes(6)}-${bytes(2)}`;
}

/**
 * Ein Markerblock wie in Avid „StreamItems“-XML (siehe exportierte Marker-Datei).
 * 10 Attribute + abschließendes leeres `ListElem`.
 */
function buildStreamItemsMarkerBlock(options: {
  timecode: string;
  comment: string;
  nowSec: number;
  userLabel: string;
}): string {
  const { timecode, comment, nowSec, userLabel } = options;
  const id = generateCrmId();
  const com = escapeAvidStringAttributeValue(comment);
  const user = escapeAvidStringAttributeValue(userLabel);
  const mod = nowSec;
  return `    <AvClass id="ATTR">
      <AvProp id="ATTR" name="__OMFI:ATTR:NumItems" type="int32">10</AvProp>
      <List id="OMFI:ATTR:AttrRefs">
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">1</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_LONG_CREATE_DATE</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:IntAttribute" type="int32">${nowSec}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_USER</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">${user}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_COM</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">${com}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">1</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_LONG_MOD_DATE</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:IntAttribute" type="int32">${mod}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_COLOR_EXTENDED</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">Red</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_COLOR</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">Red</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_ID</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">${id}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_TC</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">${escapeAvidStringAttributeValue(timecode)}</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">2</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_TRK</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:StringAttribute" type="string">V1</AvProp>
        </ListElem>
        <ListElem>
          <AvProp id="ATTR" name="OMFI:ATTB:Kind" type="int32">1</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:Name" type="string">_ATN_CRM_LENGTH</AvProp>
          <AvProp id="ATTR" name="OMFI:ATTB:IntAttribute" type="int32">1</AvProp>
        </ListElem>
        <ListElem/>
      </List>
    </AvClass>`;
}

/**
 * Sammelt alle Playlist-Zeilen mit effektiver Warnung, sortiert nach Programm-Start (rec in).
 */
export function collectAvidWarningMarkerRows(
  playlist: PlaylistEntry[],
  playlistMergedTags: AudioTags[],
  fps: number = DEFAULT_FPS
): { timecode: string; comment: string; recInFrames: number }[] {
  const out: { timecode: string; comment: string; recInFrames: number }[] = [];
  for (let i = 0; i < playlist.length; i++) {
    const row = playlist[i]!;
    const merged = playlistMergedTags[i] ?? {};
    if (!warnungEffective(merged)) continue;
    const timecode = row.recIn.trim() || framesToTimecode(row.recInFrames, fps);
    out.push({
      timecode,
      comment: buildAvidMarkerCommentText(merged),
      recInFrames: row.recInFrames,
    });
  }
  out.sort((a, b) => a.recInFrames - b.recInFrames);
  return out;
}

export type BuildAvidMarkerXmlOptions = {
  /** Sicht in `_ATN_CRM_USER` (z. B. Musiclist). */
  userLabel?: string;
};

/**
 * Avid StreamItems-XML (wie Datei-Export „Markers“ aus Media Composer / gleiches Schema
 * mit DOCTYPE + `Avid:XMLFileData` + `AvClass`-Markerblöcke).
 */
export function buildAvidMarkerXmlString(
  rows: { timecode: string; comment: string }[],
  _fps: number = DEFAULT_FPS,
  options?: BuildAvidMarkerXmlOptions
): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const user = options?.userLabel?.trim() || "Musiclist";
  const blocks = rows.map((r) =>
    buildStreamItemsMarkerBlock({
      timecode: r.timecode,
      comment: r.comment,
      nowSec,
      userLabel: user,
    })
  );
  const body = blocks.join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<!DOCTYPE Avid:StreamItems SYSTEM "AvidSettingsFile.dtd">
<Avid:StreamItems xmlns:Avid="http://www.avid.com">

  <Avid:XMLFileData>
    <AvProp name="DomainMagic" type="string">Domain</AvProp>
    <AvProp name="DomainKey" type="char4">1480739396x</AvProp>
${body}
  </Avid:XMLFileData>

</Avid:StreamItems>
`;
}

export function defaultAvidMarkerXmlFileName(loadedFileName: string): string {
  const base = basenamePath(loadedFileName);
  const stem = base.replace(/\.(edl|list|egpl|xls|xlsx|txt)$/i, "") || base;
  return `${stem}-Avid-Marker.xml`;
}

/**
 * Lädt die XML-Datei im Browser herunter.
 */
export function downloadAvidMarkerXmlFile(
  xml: string,
  downloadName: string
): void {
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = downloadName;
  a.click();
  URL.revokeObjectURL(url);
}
