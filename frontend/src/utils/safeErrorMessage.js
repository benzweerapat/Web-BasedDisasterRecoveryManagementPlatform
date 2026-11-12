export function safeErrorMessage(error, fallback = 'The request could not be completed.') {
  const body = error?.response?.data || {};
  const detail = body.error || body;
  const code = detail?.code || body?.code || error?.code;
  const message = detail?.safeMessage || body?.safeMessage || error?.safeMessage || fallback;
  return code && !String(message).includes(code) ? `${message} (${code})` : message;
}
