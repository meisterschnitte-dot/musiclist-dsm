export type EdlEvent = {
  eventNum: string;
  reel: string;
  track: string;
  editType: "C" | "D";
  srcIn: string;
  srcOut: string;
  recIn: string;
  recOut: string;
  sourceFile?: string;
};

export type PlaylistEntry = {
  id: string;
  /** Anzeige-Name (Dateiname oder Reel) */
  title: string;
  track: string;
  /** TC-In (Programm) */
  recIn: string;
  /** TC-Out (Programm) */
  recOut: string;
  recInFrames: number;
  recOutFrames: number;
  sourceKey: string;
  /** Gesetzter Dateiname im Tracks-Ordner, wenn „identisch“ zu vorhandener Datei gewählt wurde */
  linkedTrackFileName?: string;
};
