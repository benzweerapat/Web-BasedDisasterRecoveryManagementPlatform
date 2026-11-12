const SESSION_COOKIE_NAME = "srm.nosql.sid";

const sessionCookieOptions = {
  httpOnly: true,
  secure: false, // Disabled for local HTTP testing via Vite dev server
  sameSite: "lax",
  path: "/"
};

// Fixed session expiration: 30 minutes.
// Requests do not automatically extend the cookie lifetime.
const sessionMaxAge = 30 * 60 * 1000;

module.exports = {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  sessionMaxAge
};
