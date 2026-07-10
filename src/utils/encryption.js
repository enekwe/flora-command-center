const crypto = require('crypto');

/**
 * Encryption Utility for securing OAuth tokens and sensitive data
 * Uses AES-256-GCM encryption algorithm
 */

class EncryptionService {
  constructor() {
    // Ensure encryption key is set
    this.encryptionKey = process.env.ENCRYPTION_KEY;

    if (!this.encryptionKey) {
      console.warn('ENCRYPTION_KEY not set - using development key (NOT FOR PRODUCTION)');
      this.encryptionKey = 'dev-key-1234567890abcdef1234567890abcdef'; // 32 chars for AES-256
    }

    // Convert to buffer if it's a hex string
    if (this.encryptionKey.length === 64) {
      this.keyBuffer = Buffer.from(this.encryptionKey, 'hex');
    } else if (this.encryptionKey.length === 32) {
      this.keyBuffer = Buffer.from(this.encryptionKey, 'utf8');
    } else {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters or 32 ASCII characters)');
    }

    this.algorithm = 'aes-256-gcm';
    this.ivLength = 16; // 128 bits
    this.saltLength = 64;
    this.tagLength = 16;
    this.tagPosition = this.saltLength + this.ivLength;
    this.encryptedPosition = this.tagPosition + this.tagLength;
  }

  /**
   * Encrypt text using AES-256-GCM
   * @param {string} text - Plain text to encrypt
   * @returns {string} - Encrypted text in base64 format
   */
  encrypt(text) {
    if (!text) {
      throw new Error('Text to encrypt cannot be empty');
    }

    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);

      // Generate random salt
      const salt = crypto.randomBytes(this.saltLength);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.keyBuffer, iv);

      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get auth tag
      const tag = cipher.getAuthTag();

      // Combine salt + iv + tag + encrypted data
      const combined = Buffer.concat([
        salt,
        iv,
        tag,
        Buffer.from(encrypted, 'hex')
      ]);

      // Return as base64
      return combined.toString('base64');
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt text using AES-256-GCM
   * @param {string} encryptedText - Encrypted text in base64 format
   * @returns {string} - Decrypted plain text
   */
  decrypt(encryptedText) {
    if (!encryptedText) {
      throw new Error('Encrypted text cannot be empty');
    }

    try {
      // Convert from base64 to buffer
      const combined = Buffer.from(encryptedText, 'base64');

      // Extract components
      const salt = combined.subarray(0, this.saltLength);
      const iv = combined.subarray(this.saltLength, this.tagPosition);
      const tag = combined.subarray(this.tagPosition, this.encryptedPosition);
      const encrypted = combined.subarray(this.encryptedPosition);

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.keyBuffer, iv);
      decipher.setAuthTag(tag);

      // Decrypt the text
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate a secure random encryption key (32 bytes hex)
   * @returns {string} - Random 64-character hex string
   */
  static generateKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a string using SHA-256
   * @param {string} text - Text to hash
   * @returns {string} - Hashed text
   */
  hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Encrypt state parameter for OAuth flows
   * @param {Object} stateData - State data to encrypt (userId, organizationId, etc.)
   * @returns {string} - Encrypted state parameter
   */
  encryptState(stateData) {
    const stateString = JSON.stringify(stateData);
    return this.encrypt(stateString);
  }

  /**
   * Decrypt state parameter from OAuth callback
   * @param {string} encryptedState - Encrypted state parameter
   * @returns {Object} - Decrypted state data
   */
  decryptState(encryptedState) {
    const decrypted = this.decrypt(encryptedState);
    return JSON.parse(decrypted);
  }
}

// Export singleton instance
module.exports = new EncryptionService();
