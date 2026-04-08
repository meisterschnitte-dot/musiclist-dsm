/**
 * Lokaler API-Dienst für Einladungs-Mails (SMTP wie Dispo-Kalender).
 * Start: npm run dev:mail (oder zusammen mit Vite: npm run dev)
 */
import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import nodemailer from "nodemailer";
import fsPromises from "node:fs/promises";
import os from "node:os";
import { INITIAL_INVITE_PASSWORD } from "./constants";
import { bearerAuth, requireAdmin } from "./authMiddleware";
import { createCustomerEdlRouter } from "./customerEdlRoutes";
import {
  registerPlaylistAssignmentForCustomer,
  type PlaylistLibraryRef,
} from "./customerPlaylistAssignmentsFs";
import { removePlaylistPendingForRef } from "./customerPlaylistPendingFs";
import { createCustomersRouter } from "./customersRoutes";
import { createUserApiRouter } from "./userRoutes";
import { createBlankframeRouter } from "./blankframeRoutes";
import { createUserSessionSyncRouter } from "./userSessionSyncRoutes";
import { createUserEdlRouter } from "./userEdlRoutes";
import { createSharedTracksRouter } from "./sharedTracksRoutes";
import { getResolvedServerStoragePaths } from "./sharedTracksFs";
import { streamFullDataBackupZip } from "./fullBackup";
import { restoreDataDirectoryFromBackupZip } from "./restoreBackup";

const PORT =
  Number(process.env.MUSICLIST_MAIL_PORT || process.env.EASY_GEMA_MAIL_PORT) || 5274;
const DISPO_CC = process.env.SMTP_BCC?.trim() || "dispo@dsm.team";

const ALLOWED_ORIGINS = (process.env.MUSICLIST_APP_URL || "http://localhost:5273")
  .split(",")
  .map((u) => u.trim().replace(/\/$/, ""));

const getTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Musiclist Mail] SMTP nicht vollständig konfiguriert (.env).");
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

async function sendEmailWithOptions({
  to,
  subject,
  text,
  html,
  attachments,
}: {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<void> {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || DISPO_CC;
  const toList = (Array.isArray(to) ? to : [to]).map((x) => x.trim()).filter(Boolean);
  const toStr = toList.join(", ");
  if (!toStr) {
    throw new Error("Keine Empfänger.");
  }
  const sendBcc =
    toList.some((t) => t.toLowerCase() !== DISPO_CC.toLowerCase()) && DISPO_CC.length > 0;

  if (!transporter) {
    console.log(`
--- E-MAIL (Simulation) ---
An: ${toStr}
${sendBcc ? `BCC: ${DISPO_CC}\n` : ""}Von: ${from}
Betreff: ${subject}
${attachments?.length ? `Anhänge: ${attachments.map((a) => a.filename).join(", ")}\n` : ""}${html ? `--- text ---\n${text}\n--- html ---\n${html}\n` : text}
---------------------------
`);
    return;
  }

  await transporter.sendMail({
    from,
    to: toStr,
    subject,
    text,
    ...(html?.trim() && { html: html.trim() }),
    ...(attachments?.length && { attachments }),
    ...(sendBcc && { bcc: DISPO_CC }),
  });
  console.log(`[Musiclist Mail] Gesendet an ${toStr}`);
}

async function sendEmail(props: { to: string; subject: string; text: string }): Promise<void> {
  return sendEmailWithOptions(props);
}

const app = express();

/** ZIP-Upload für Havarie-Wiederherstellung (Admin); typisch &lt; 1 GB — Nginx ggf. `client_max_body_size` erhöhen. */
const uploadRestoreBackup = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, _file, cb) => cb(null, `musiclist-restore-${Date.now()}-${process.pid}.zip`),
  }),
  limits: { fileSize: 1536 * 1024 * 1024 },
});

// --- Security ---
app.use(cors({
  origin: process.env.NODE_ENV === "production" ? ALLOWED_ORIGINS : true,
  credentials: true,
}));

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(express.json({ limit: "25mb" }));

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // max 15 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen." },
});
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/bootstrap", authLimiter);

app.use("/api", createUserApiRouter());
app.use("/api", createUserSessionSyncRouter());
app.use("/api", createBlankframeRouter());
app.use("/api", createUserEdlRouter());
app.use("/api", createCustomerEdlRouter());
app.use("/api", createSharedTracksRouter());
app.use("/api", createCustomersRouter());

/** Nur Admins: vollständige ZIP-Sicherung von `data/` inkl. MP3s (Streaming). */
app.get("/api/admin/full-backup", bearerAuth, requireAdmin, (_req, res) => {
  streamFullDataBackupZip(res);
});

/** Nur Admins: ZIP einer früheren Datensicherung einspielen (ersetzt `data/`; altes Verzeichnis → `data.pre-restore-*`). */
app.post(
  "/api/admin/restore-backup",
  bearerAuth,
  requireAdmin,
  (req, res, next) => {
    uploadRestoreBackup.single("backup")(req, res, (err: unknown) => {
      if (err) {
        const m = err instanceof Error ? err.message : String(err);
        const code = (err as { code?: string }).code;
        if (code === "LIMIT_FILE_SIZE") {
          res.status(413).json({ error: "Datei zu groß (max. ca. 1,5 GB)." });
          return;
        }
        res.status(400).json({ error: m || "Upload fehlgeschlagen." });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const file = (req as express.Request & { file?: Express.Multer.File }).file;
    const zipPath = file?.path;
    if (!zipPath) {
      res.status(400).json({ error: "Keine ZIP-Datei (Formularfeld backup)." });
      return;
    }
    try {
      const { previousDataRenamedTo } = await restoreDataDirectoryFromBackupZip(zipPath);
      res.json({ ok: true, previousDataRenamedTo });
    } catch (e) {
      console.error("[Musiclist API] restore-backup:", e);
      res.status(500).json({
        error: e instanceof Error ? e.message : "Wiederherstellung fehlgeschlagen.",
      });
    } finally {
      await fsPromises.unlink(zipPath).catch(() => {});
    }
  }
);

/** Angemeldete Nutzer: echte Serverpfade (kleines Team, intern). */
app.get("/api/storage-paths", bearerAuth, (req, res) => {
  try {
    const uid = req.authUser?.id;
    if (!uid) {
      res.status(401).json({ error: "Nicht angemeldet." });
      return;
    }
    res.json(getResolvedServerStoragePaths(uid));
  } catch (e) {
    console.error("[Musiclist API] storage-paths:", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Speicherpfade konnten nicht ermittelt werden.",
    });
  }
});

app.post("/api/send-mail", bearerAuth, requireAdmin, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const toRaw = body.to;
    const to =
      Array.isArray(toRaw)
        ? toRaw.map((x) => String(x).trim()).filter(Boolean)
        : typeof toRaw === "string"
          ? [toRaw.trim()].filter(Boolean)
          : [];
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    const text = typeof body.text === "string" ? body.text : "";
    const htmlRaw = body.html;
    const html = typeof htmlRaw === "string" && htmlRaw.trim() ? htmlRaw.trim() : undefined;
    const attB64 = typeof body.attachmentBase64 === "string" ? body.attachmentBase64 : "";
    const attName =
      typeof body.attachmentFileName === "string" && body.attachmentFileName.trim()
        ? body.attachmentFileName.trim().replace(/[\\/]/g, "_")
        : "export.xlsx";

    if (!to.length) {
      return res.status(400).json({ error: "Mindestens einen Empfänger angeben." });
    }
    if (!subject) {
      return res.status(400).json({ error: "Betreff ist erforderlich." });
    }
    if (to.length > 80) {
      return res.status(400).json({ error: "Zu viele Empfänger (max. 80)." });
    }

    const attachments =
      attB64.length > 0
        ? [{ filename: attName, content: Buffer.from(attB64, "base64") }]
        : undefined;

    const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
    const libraryOwnerRaw = typeof body.libraryOwnerUserId === "string" ? body.libraryOwnerUserId.trim() : "";
    const libraryOwnerUserId = libraryOwnerRaw || req.authUser?.id || "";
    const playlistFileName = typeof body.playlistFileName === "string" ? body.playlistFileName.trim() : "";
    const psRaw = body.parentSegments;
    const parentSegments = Array.isArray(psRaw)
      ? psRaw.filter((x): x is string => typeof x === "string")
      : [];
    /** Zuerst persistieren — auch wenn SMTP später fehlschlägt, sieht der Kunde die Freigabe. */
    if (customerId && libraryOwnerUserId && playlistFileName) {
      try {
        const ref: PlaylistLibraryRef = {
          libraryOwnerUserId,
          parentSegments,
          fileName: playlistFileName,
        };
        await registerPlaylistAssignmentForCustomer(customerId, ref);
        await removePlaylistPendingForRef(ref);
      } catch (e) {
        console.error("[Musiclist Mail] playlist assignment:", e);
        return res.status(500).json({
          error: e instanceof Error ? e.message : "Playlist-Zuweisung fehlgeschlagen.",
        });
      }
    }

    await sendEmailWithOptions({ to, subject, text, html, attachments });

    return res.json({ ok: true });
  } catch (e) {
    console.error("[Musiclist Mail] send-mail:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "E-Mail-Versand fehlgeschlagen.",
    });
  }
});

/** Nur angemeldete Admins — kein separates VITE_MUSICLIST_MAIL_SECRET nötig. */
app.post("/api/send-user-invite", bearerAuth, requireAdmin, async (req, res) => {
  try {
    const { email, firstName, lastName, appUrl } = req.body as Record<string, unknown>;
    const em = typeof email === "string" ? email.trim() : "";
    const fn = typeof firstName === "string" ? firstName.trim().replace(/[\r\n]/g, "") : "";
    const ln = typeof lastName === "string" ? lastName.trim().replace(/[\r\n]/g, "") : "";
    const baseUrl =
      typeof appUrl === "string" && appUrl.trim()
        ? appUrl.trim().replace(/\/$/, "")
        : (
            process.env.MUSICLIST_APP_URL ||
            process.env.EASY_GEMA_APP_URL ||
            "http://localhost:5273"
          ).replace(/\/$/, "");

    if (!em || !fn || !ln) {
      return res.status(400).json({ error: "E-Mail, Vorname und Nachname sind erforderlich." });
    }

    const subject = "Willkommen bei Musiclist — Deine Zugangsdaten";
    const text = `Hallo ${fn} ${ln},

willkommen bei Musiclist! Wir haben ein Benutzerkonto für Dich angelegt.

Zugangsdaten:
• E-Mail-Adresse (Anmeldename): ${em}
• Initialpasswort: ${INITIAL_INVITE_PASSWORD}

Wichtig: Bitte ändere dieses Initialpasswort direkt beim ersten Login. Die App fordert dich dazu auf, sobald du dich das erste Mal anmeldest.

App öffnen: ${baseUrl}

Bei Fragen wende dich gerne an mich.

Viele Grüße
Oliver Driemel`;

    await sendEmail({ to: em, subject, text });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[Musiclist Mail] Versand fehlgeschlagen:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "E-Mail-Versand fehlgeschlagen.",
    });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "musiclist-mail" });
});

app.listen(PORT, () => {
  console.log(
    `[Musiclist API] http://localhost:${PORT} — /api/* (Benutzer, Kunden, Mail send-mail)`
  );
});
