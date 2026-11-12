const crypto = require('crypto');

class VRVisibilityNormalizerService {
  normalizeSeverity(rawStatus) {
    if (!rawStatus) return 'UNKNOWN';

    const s = rawStatus.toUpperCase();

    if (
      ['INFO', 'INFORMATION']
        .includes(s)
    ) {
      return 'INFO';
    }

    if (
      ['WARNING', 'WARN']
        .includes(s)
    ) {
      return 'WARNING';
    }

    if (
      ['ERROR', 'SEVERE', 'FAULT']
        .includes(s)
    ) {
      return 'ERROR';
    }

    if (
      ['CRITICAL', 'FATAL']
        .includes(s)
    ) {
      return 'CRITICAL';
    }

    return 'UNKNOWN';
  }

  generateIssueFingerprint(
    scope,
    pairingId,
    canonicalKey,
    entity,
    issueType,
    description,
    occurredAt
  ) {
    const raw = JSON.stringify([
      "v1",
      scope || null,
      pairingId || null,
      canonicalKey || null,
      entity || null,
      issueType || null,
      this.redactText(description) ||
        null
    ]);

    return crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');
  }

  redactText(text) {
    if (!text) return null;

    let redacted = text.toString();

    redacted = redacted.replace(
      /password=[^\s&]+/gi,
      'password=***'
    );

    redacted = redacted.replace(
      /session_id=[^\s&]+/gi,
      'session_id=***'
    );

    redacted = redacted.replace(
      /Authorization:\s*Basic\s+[^\s]+/gi,
      'Authorization: Basic ***'
    );

    redacted = redacted.replace(
      /Authorization:\s*Bearer\s+[^\s]+/gi,
      'Authorization: Bearer ***'
    );

    return redacted;
  }

  sanitizeUrl(rawUrl) {
    if (!rawUrl) return null;

    try {
      const u = new URL(rawUrl);

      u.username = '';
      u.password = '';
      u.search = '';
      u.hash = '';

      return u.toString();
    } catch {
      return rawUrl;
    }
  }

  normalizeTaskStatus(rawStatus) {
    if (!rawStatus) return 'UNKNOWN';

    const s = rawStatus.toUpperCase();

    if (s.includes('QUEUE')) {
      return 'QUEUED';
    }

    if (
      s.includes('RUN') ||
      s.includes('IN_PROGRESS')
    ) {
      return 'RUNNING';
    }

    if (
      s.includes('SUCCESS') ||
      s.includes('DONE') ||
      s.includes('COMPLETED')
    ) {
      return 'SUCCEEDED';
    }

    if (
      s.includes('FAIL') ||
      s.includes('ERROR')
    ) {
      return 'FAILED';
    }

    if (s.includes('CANCEL')) {
      return 'CANCELLED';
    }

    return 'UNKNOWN';
  }

  extractSafeTaskError(errorObj) {
    if (!errorObj) {
      return {
        message: null,
        details: null
      };
    }

    const safeError = {};

    if (errorObj.message) {
      safeError.message =
        this.redactText(
          errorObj.message
        );
    }

    if (errorObj.details) {
      safeError.details =
        this.redactText(
          typeof errorObj.details ===
            'string'
            ? errorObj.details
            : JSON.stringify(
                errorObj.details
              )
        );
    }

    return safeError;
  }

  extractSafeResultSummary(resultObj) {
    if (!resultObj) {
      return {
        summary: null,
        truncated: false
      };
    }

    const MAX_SIZE = 1000;
    let rawStr = '';

    if (typeof resultObj === 'string') {
      rawStr = resultObj;
    } else {
      try {
        rawStr =
          JSON.stringify(resultObj);
      } catch (e) {
        rawStr = String(resultObj);
      }
    }

    rawStr =
      this.redactText(rawStr);

    if (rawStr.length > MAX_SIZE) {
      return {
        summary:
          rawStr.substring(
            0,
            MAX_SIZE
          ) +
          '...[TRUNCATED]',

        truncated: true
      };
    }

    return {
      summary: rawStr,
      truncated: false
    };
  }

  extractSafeCertificateSummary(
    certObj
  ) {
    if (!certObj) return null;

    const now = Date.now();

    const notAfter =
      certObj.not_after || 0;

    const daysRemaining =
      (notAfter - now) /
      (1000 * 60 * 60 * 24);

    let status = 'VALID';

    if (notAfter > 0) {
      if (daysRemaining < 0) {
        status = 'EXPIRED';
      } else if (
        daysRemaining <= 30
      ) {
        status = 'EXPIRING_SOON';
      }
    } else {
      status = 'UNKNOWN';
    }

    if (
      certObj.warning_count > 0 &&
      status === 'VALID'
    ) {
      status = 'WARNING';
    }

    return {
      serial_number:
        certObj.serial_number,

      thumbprint:
        certObj.thumbprint,

      subject:
        this.redactText(
          certObj.subject
        ),

      issuer:
        this.redactText(
          certObj.issuer
        ),

      not_before:
        certObj.not_before,

      not_after:
        notAfter,

      signature_algorithm:
        certObj.signature_algorithm,

      public_key_algorithm:
        certObj.public_key_algorithm,

      warning_count:
        certObj.warning_count || 0,

      status
    };
  }
}

module.exports =
  new VRVisibilityNormalizerService();