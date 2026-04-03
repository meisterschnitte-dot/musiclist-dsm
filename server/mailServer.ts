/**
 * Lokaler API-Dienst für Einladungs-Mails (SMTP wie Dispo-Kalender).
 * Start: npm run dev:mail (oder zusammen mit Vite: npm run dev)
 */
import "dotenv/config";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import { INITIAL_INVITE_PASSWORD } from "./constants";
import { createUserApiRouter } from "./userRoutes";
import { createUserEdlRouter } from "./userEdlRoutes";
import { createSharedTracksRouter } from "./sharedTracksRoutes";

const PORT =
  Number(process.env.MUSICLIST_MAIL_PORT || process.env.EASY_GEMA_MAIL_PORT) || 5274;
const MAIL_SECRET =
  process.env.MUSICLIST_MAIL_SECRET?.trim() || process.env.EASY_GEMA_MAIL_SECRET?.trim();
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

async function sendEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM || DISPO_CC;
  const sendBcc = to.trim().toLowerCase() !== DISPO_CC.toLowerCase() && DISPO_CC.length > 0;

  if (!transporter) {
    console.log(`
--- E-MAIL (Simulation) ---
An: ${to}
${sendBcc ? `BCC: ${DISPO_CC}\n` : ""}Von: ${from}
Betreff: ${subject}
${text}
---------------------------
`);
    return;
  }

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    ...(sendBcc && { bcc: DISPO_CC }),
  });
  console.log(`[Musiclist Mail] Gesendet an ${to}`);
}

const app = express();

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

app.use(express.json({ limit: "10mb" }));

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
app.use("/api", createUserEdlRouter());
app.use("/api", createSharedTracksRouter());

app.post("/api/send-user-invite", async (req, res) => {
  try {
    if (MAIL_SECRET) {
      const h =
        req.headers["x-musiclist-mail-secret"] ?? req.headers["x-easy-gema-mail-secret"];
      if (h !== MAIL_SECRET) {
        return res.status(403).json({ error: "Ungültiges API-Geheimnis." });
      }
    }

    const { email, firstName, lastName, roleLabel, appUrl } = req.body as Record<string, unknown>;
    const em = typeof email === "string" ? email.trim() : "";
    const fn = typeof firstName === "string" ? firstName.trim().replace(/[\r\n]/g, "") : "";
    const ln = typeof lastName === "string" ? lastName.trim().replace(/[\r\n]/g, "") : "";
    const role = typeof roleLabel === "string" ? roleLabel.trim().replace(/[\r\n]/g, "") : "Benutzer";
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

    const subject = "Einladung zu Musiclist";
    const text = `Hallo ${fn} ${ln},

Sie wurden als ${role} für die Anwendung Musiclist eingeladen.

Ihre Zugangsdaten:
E-Mail (Anmeldename): ${em}
Initiales Passwort: ${INITIAL_INVITE_PASSWORD}

WICHTIG — Sicherheit:
Bitte ändern Sie dieses Passwort unmittelbar nach der ersten Anmeldung (über eine künftige Passwort-Funktion oder durch Rücksprache mit Ihrem Administrator).

Anwendung öffnen: ${baseUrl}

Bei Fragen wenden Sie sich an Ihren Administrator.

Viele Grüße
Ihr Team`;

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
    `[Musiclist API] http://localhost:${PORT} — Benutzer-API unter /api/*, Mail: POST /api/send-user-invite`
  );
});
