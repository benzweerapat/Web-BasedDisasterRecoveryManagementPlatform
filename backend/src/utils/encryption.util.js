const crypto = require('crypto');

const rawKey = process.env.VMWARE_CREDENTIAL_KEY;

if (!rawKey) {
  throw new Error("VMWARE_CREDENTIAL_KEY is required");
}

const encryptionKey = Buffer.from(rawKey, "base64");

if (encryptionKey.length !== 32) {
  throw new Error("VMWARE_CREDENTIAL_KEY must decode to exactly 32 bytes");
}

/**
 * Encrypts a plaintext string
 * @param {string} plaintext 
 */
function encryptCredential(plaintext) {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Credential is required");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedPassword: ciphertext.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionAuthTag: authTag.toString("base64")
  };
}

/**
 * Decrypts an encrypted string
 * @param {string} encryptedPassword
 * @param {string} encryptionIv
 * @param {string} encryptionAuthTag
 */
function decryptCredential(encryptedPassword, encryptionIv, encryptionAuthTag) {
  if (
    typeof encryptedPassword !== "string" ||
    typeof encryptionIv !== "string" ||
    typeof encryptionAuthTag !== "string"
  ) {
    throw new Error("Invalid credential format");
  }

  try {
    const iv = Buffer.from(encryptionIv, "base64");
    const authTag = Buffer.from(encryptionAuthTag, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedPassword, "base64")),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    // Fail general error, do not expose specifics
    throw new Error("Failed to decrypt credential");
  }
}

module.exports = {
  encryptCredential,
  decryptCredential
};