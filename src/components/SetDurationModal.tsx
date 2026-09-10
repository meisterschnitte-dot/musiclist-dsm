import { useCallback, useEffect, useState } from "react";
import type { PlaylistEntry } from "../edl/types";
import {
  DEFAULT_FPS,
  durationInputToFrames,
  framesToTimecode,
  framesToTimecodeDuration,
  normalizeFramesToDay,
  playlistDurationTimecode,
  timecodeInputToFrames,
} from "../edl/timecode";

type Props = {
  open: boolean;
  row: PlaylistEntry;
  rowIndex: number;
  fps?: number;
  onClose: () => void;
  onSave: (recInFrames: number, recOutFrames: number) => void;
};

function durationDraftFromRow(row: PlaylistEntry, fps: number): string {
  return playlistDurationTimecode(row.recInFrames, row.recOutFrames, fps);
}

export function SetDurationModal({
  open,
  row,
  rowIndex,
  fps = DEFAULT_FPS,
  onClose,
  onSave,
}: Props) {
  const [tcInDraft, setTcInDraft] = useState(row.recIn);
  const [tcOutDraft, setTcOutDraft] = useState(row.recOut);
  const [durationDraft, setDurationDraft] = useState(() => durationDraftFromRow(row, fps));
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTcInDraft(row.recIn);
    setTcOutDraft(row.recOut);
    setDurationDraft(durationDraftFromRow(row, fps));
    setErr(null);
  }, [open, row, fps]);

  const applyTcInChange = useCallback(
    (raw: string) => {
      try {
        const newIn = timecodeInputToFrames(raw, fps);
        const curIn = timecodeInputToFrames(tcInDraft, fps);
        const curOut = timecodeInputToFrames(tcOutDraft, fps);
        const span = curOut - curIn;
        if (span > 0) {
          const newOut = normalizeFramesToDay(newIn + span, fps);
          setTcOutDraft(framesToTimecode(newOut, fps));
          setDurationDraft(framesToTimecodeDuration(span, fps));
        }
        setErr(null);
      } catch {
        /* Fehler erst beim Speichern */
      }
      setTcInDraft(raw);
    },
    [fps, tcInDraft, tcOutDraft]
  );

  const applyTcOutChange = useCallback(
    (raw: string) => {
      setTcOutDraft(raw);
      try {
        const inFr = timecodeInputToFrames(tcInDraft, fps);
        const outFr = timecodeInputToFrames(raw, fps);
        const span = outFr - inFr;
        if (span > 0) {
          setDurationDraft(framesToTimecodeDuration(span, fps));
        }
        setErr(null);
      } catch {
        /* Fehler erst beim Speichern */
      }
    },
    [fps, tcInDraft]
  );

  const applyDurationChange = useCallback(
    (raw: string) => {
      setDurationDraft(raw);
      try {
        const inFr = timecodeInputToFrames(tcInDraft, fps);
        const dur = durationInputToFrames(raw, fps);
        if (dur <= 0) return;
        const outFr = normalizeFramesToDay(inFr + dur, fps);
        setTcOutDraft(framesToTimecode(outFr, fps));
        setErr(null);
      } catch {
        /* Fehler erst beim Speichern */
      }
    },
    [fps, tcInDraft]
  );

  const submit = useCallback(() => {
    setErr(null);
    try {
      const inFr = normalizeFramesToDay(timecodeInputToFrames(tcInDraft, fps), fps);
      let outFr = normalizeFramesToDay(timecodeInputToFrames(tcOutDraft, fps), fps);
      const durFromField = durationInputToFrames(durationDraft, fps);
      const spanFromOut = outFr - inFr;
      const spanFromDur = durFromField;
      if (spanFromOut <= 0 && spanFromDur <= 0) {
        setErr("TC-Out muss nach TC-In liegen (positive Dauer).");
        return;
      }
      if (spanFromOut <= 0 || Math.abs(spanFromOut - spanFromDur) > fps) {
        outFr = normalizeFramesToDay(inFr + spanFromDur, fps);
      }
      if (outFr === inFr || outFr - inFr <= 0) {
        setErr("TC-Out muss nach TC-In liegen (positive Dauer).");
        return;
      }
      onSave(inFr, outFr);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Timecode ungültig.");
    }
  }, [tcInDraft, tcOutDraft, durationDraft, fps, onSave]);

  if (!open) return null;

  const title = row.title.trim() || row.sourceKey.slice(0, 48);

  return (
    <div
      className="modal-backdrop modal-backdrop--stacked"
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-duration-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal modal--set-duration" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="set-duration-title" className="modal-title">
          Set Duration
        </h2>
        <p className="modal-lead modal-lead--muted">
          Zeile {rowIndex + 1}
          {title ? (
            <>
              {" "}
              — <span className="mono-cell">{title}</span>
            </>
          ) : null}
        </p>
        {err ? (
          <p className="user-auth-err modal-lead" role="alert">
            {err}
          </p>
        ) : null}
        <div className="set-duration-fields">
          <label className="tag-field">
            <span>TC In</span>
            <input
              type="text"
              className="mono-cell"
              value={tcInDraft}
              onChange={(e) => applyTcInChange(e.target.value)}
              onBlur={() => {
                try {
                  setTcInDraft(framesToTimecode(timecodeInputToFrames(tcInDraft, fps), fps));
                } catch {
                  /* unverändert lassen */
                }
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder="00:00:00:00"
              title="Programm-TC In (HH:MM:SS:FF oder Ziffern)"
            />
          </label>
          <label className="tag-field">
            <span>TC Out</span>
            <input
              type="text"
              className="mono-cell"
              value={tcOutDraft}
              onChange={(e) => applyTcOutChange(e.target.value)}
              onBlur={() => {
                try {
                  setTcOutDraft(framesToTimecode(timecodeInputToFrames(tcOutDraft, fps), fps));
                } catch {
                  /* unverändert lassen */
                }
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder="00:00:00:00"
              title="Programm-TC Out (HH:MM:SS:FF oder Ziffern)"
            />
          </label>
          <label className="tag-field">
            <span>Duration</span>
            <input
              type="text"
              className="mono-cell"
              value={durationDraft}
              onChange={(e) => applyDurationChange(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="00:00:00:00"
              title="Dauer zwischen TC In und TC Out"
            />
          </label>
        </div>
        <p className="modal-lead modal-lead--muted set-duration-hint">
          TC In verschiebt TC Out bei gleicher Dauer. Duration passt TC Out an TC In an.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-modal btn-modal--ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button type="button" className="btn-modal" onClick={submit}>
            Übernehmen
          </button>
        </div>
      </div>
    </div>
  );
}
