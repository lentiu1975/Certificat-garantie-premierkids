/**
 * Utilitar pentru criptare/decriptare credențiale API
 * Folosește AES-256-GCM pentru securitate maximă
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const constants = require('../config/constants');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

/**
 * Derivă o cheie din parola/cheia de criptare folosind PBKDF2
 */
function deriveKey(password, salt) {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Criptează un obiect de credențiale
 * @param {Object} credentials - Obiectul cu credențiale
 * @param {string} encryptionKey - Cheia de criptare din .env
 * @returns {string} - String criptat în format base64
 */
function encryptCredentials(credentials, encryptionKey) {
    if (!encryptionKey || encryptionKey.length < 32) {
        throw new Error('Cheia de criptare trebuie să aibă minim 32 de caractere');
    }

    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(encryptionKey, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(credentials);

    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    const authTag = cipher.getAuthTag();

    // Combinăm: salt + iv + authTag + encrypted
    const combined = Buffer.concat([
        salt,
        iv,
        authTag,
        Buffer.from(encrypted, 'base64')
    ]);

    return combined.toString('base64');
}

/**
 * Decriptează credențialele
 * @param {string} encryptedData - Datele criptate în format base64
 * @param {string} encryptionKey - Cheia de criptare din .env
 * @returns {Object} - Obiectul cu credențiale decriptate
 */
function decryptCredentials(encryptedData, encryptionKey) {
    if (!encryptionKey || encryptionKey.length < 32) {
        throw new Error('Cheia de criptare trebuie să aibă minim 32 de caractere');
    }

    const combined = Buffer.from(encryptedData, 'base64');

    // Extragem componentele
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(encryptionKey, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
}

/**
 * Salvează credențialele criptate în fișier
 */
function saveCredentials(credentials, encryptionKey) {
    const encrypted = encryptCredentials(credentials, encryptionKey);

    const credentialsPath = path.resolve(constants.FILES.CREDENTIALS_PATH);
    const dir = path.dirname(credentialsPath);

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(credentialsPath, encrypted, 'utf8');
    return true;
}

/**
 * Încarcă credențialele din fișier și le decriptează
 */
function loadCredentials(encryptionKey) {
    const credentialsPath = path.resolve(constants.FILES.CREDENTIALS_PATH);

    if (!fs.existsSync(credentialsPath)) {
        return null;
    }

    const encrypted = fs.readFileSync(credentialsPath, 'utf8');
    return decryptCredentials(encrypted, encryptionKey);
}

/**
 * Verifică dacă există fișierul de credențiale
 */
function credentialsExist() {
    return fs.existsSync(path.resolve(constants.FILES.CREDENTIALS_PATH));
}

module.exports = {
    encryptCredentials,
    decryptCredentials,
    saveCredentials,
    loadCredentials,
    credentialsExist
};
