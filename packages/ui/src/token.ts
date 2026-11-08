/**
 * The server makes a new token every time it starts and puts it in index.html. A page left
 * open across a restart still holds the old one, so before reconnecting the page fetches its
 * own index.html again (same origin) and reads the current token from it.
 */
export const TOKEN_META = "pixel-office-token";

const PATTERN = new RegExp(`<meta name="${TOKEN_META}" content="([0-9a-f]{64})"`);

/** The token in a served index.html, or undefined when there is none. */
export function readToken(html: string): string | undefined {
  return PATTERN.exec(html)?.[1];
}
