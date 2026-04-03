/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional; muss mit MUSICLIST_MAIL_SECRET im Mail-Server übereinstimmen. */
  readonly VITE_MUSICLIST_MAIL_SECRET?: string;
  /** @deprecated Nutze VITE_MUSICLIST_MAIL_SECRET */
  readonly VITE_EASY_GEMA_MAIL_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
