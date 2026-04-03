import type { StoredUser } from "./userTypes";

declare global {
  namespace Express {
    interface Request {
      authUser?: StoredUser;
    }
  }
}

export {};
