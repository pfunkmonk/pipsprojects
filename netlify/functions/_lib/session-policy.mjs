// Chrome and other Chromium browsers cap persistent cookies at 400 days.
// Renewing the cookie on authenticated session checks keeps access durable while
// preserving explicit logout and secret-rotation invalidation.
export const PERSISTENT_SESSION_SECONDS = 400 * 24 * 60 * 60;

