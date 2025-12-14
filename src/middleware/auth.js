/**
 * Middleware pentru autentificare și autorizare
 */

const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const constants = require('../config/constants');

/**
 * Middleware care verifică dacă utilizatorul este autentificat
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    }

    // Pentru API requests, returnează JSON
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(401).json({ error: 'Neautorizat. Vă rugăm să vă autentificați.' });
    }

    // Pentru requests normale, redirect la login
    return res.redirect('/auth/login');
}

/**
 * Middleware care verifică dacă utilizatorul este admin
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.userId && req.session.isAdmin) {
        return next();
    }

    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(403).json({ error: 'Acces interzis. Necesită drepturi de administrator.' });
    }

    return res.redirect('/');
}

/**
 * Autentificare utilizator
 */
async function authenticateUser(username, password) {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    const user = stmt.get(username);

    if (!user) {
        return { success: false, error: 'Utilizator sau parolă incorectă' };
    }

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
        return { success: false, error: 'Utilizator sau parolă incorectă' };
    }

    // Actualizare last_login
    const updateStmt = db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
    updateStmt.run(user.id);

    return {
        success: true,
        user: {
            id: user.id,
            username: user.username,
            isAdmin: user.is_admin === 1
        }
    };
}

/**
 * Creare utilizator nou
 */
async function createUser(username, password, isAdmin = false) {
    if (!username || username.length < 3) {
        throw new Error('Username-ul trebuie să aibă minim 3 caractere');
    }

    if (!password || password.length < constants.SECURITY.MIN_PASSWORD_LENGTH) {
        throw new Error(`Parola trebuie să aibă minim ${constants.SECURITY.MIN_PASSWORD_LENGTH} caractere`);
    }

    const passwordHash = await bcrypt.hash(password, constants.SECURITY.BCRYPT_ROUNDS);

    const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, is_admin)
        VALUES (?, ?, ?)
    `);

    try {
        const result = stmt.run(username, passwordHash, isAdmin ? 1 : 0);
        return { success: true, userId: result.lastInsertRowid };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            throw new Error('Acest username există deja');
        }
        throw error;
    }
}

/**
 * Schimbare parolă utilizator
 */
async function changePassword(userId, oldPassword, newPassword) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(userId);

    if (!user) {
        throw new Error('Utilizator negăsit');
    }

    const isValid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!isValid) {
        throw new Error('Parola actuală este incorectă');
    }

    if (newPassword.length < constants.SECURITY.MIN_PASSWORD_LENGTH) {
        throw new Error(`Parola nouă trebuie să aibă minim ${constants.SECURITY.MIN_PASSWORD_LENGTH} caractere`);
    }

    const newHash = await bcrypt.hash(newPassword, constants.SECURITY.BCRYPT_ROUNDS);

    const updateStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    updateStmt.run(newHash, userId);

    return { success: true };
}

/**
 * Verifică dacă există utilizatori în sistem
 */
function hasUsers() {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get();
    return result.count > 0;
}

module.exports = {
    requireAuth,
    requireAdmin,
    authenticateUser,
    createUser,
    changePassword,
    hasUsers
};
