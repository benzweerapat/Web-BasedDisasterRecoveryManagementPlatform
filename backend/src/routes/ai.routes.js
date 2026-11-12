'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');
const { csrfProtection } = require('../middleware/csrf.middleware');
const { buildSafeError } = require('../utils/api-response.util');
const aiChat = require('../services/ai-chat.service');

const router = express.Router();
const requestsByIp = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const recent = (requestsByIp.get(key) || []).filter(time => now - time < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    return res.status(429).json(buildSafeError(req, {
      type: 'RATE_LIMIT_ERROR', code: 'AI_RATE_LIMITED', httpStatus: 429,
      safeMessage: 'AI Chat request limit reached. Please wait and try again.'
    }));
  }
  recent.push(now);
  requestsByIp.set(key, recent);
  next();
}

router.get('/status', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), async (_req, res, next) => {
  try { res.json({ success: true, data: await aiChat.getAiStatus() }); } catch(error) { next(error); }
});

router.post('/chat', requireAuth, requireRole('VIEWER', 'OPERATOR', 'ADMIN'), csrfProtection, rateLimit, async (req, res) => {
  try {
    const data = await aiChat.askInventoryAssistant({ question: req.body?.question, history: req.body?.history });
    res.json({ success: true, data, requestId: req.id });
  } catch (error) {
    const status = Number(error.httpStatus) || 500;
    const messages = {
      AI_INVALID_QUESTION: 'Enter a question containing no more than 2,000 characters.',
      AI_NOT_CONFIGURED: 'AI Chat is not configured on this server.',
      AI_TIMEOUT: 'AI Chat timed out. Please try again.',
      AI_RATE_LIMITED: 'AI Chat is temporarily rate limited. Please try again later.',
      AI_PROVIDER_ERROR: 'AI Chat could not complete the request.',
      AI_PROVIDER_UNAVAILABLE: 'AI Chat provider is unavailable.',
      AI_EMPTY_RESPONSE: 'AI Chat returned no answer.'
    };
    res.status(status).json(buildSafeError(req, {
      type: status === 400 ? 'VALIDATION_ERROR' : status === 429 ? 'RATE_LIMIT_ERROR' : 'UPSTREAM_ERROR',
      code: error.code || 'AI_CHAT_ERROR',
      httpStatus: status,
      safeMessage: messages[error.code] || 'AI Chat could not complete the request.'
    }));
  }
});

module.exports = router;