/** In-Memory API-Token (kein sessionStorage — nach Reload erneut anmelden). */
let usersApiToken: string | null = null;

export function setUsersApiToken(token: string | null): void {
  usersApiToken = token;
}

export function getUsersApiToken(): string | null {
  return usersApiToken;
}
