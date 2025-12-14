/**
 * Rute pentru autentificare
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const {
    authenticateUser,
    createUser,
    changePassword,
    hasUsers,
    requireAuth
} = require('../middleware/auth');

/**
 * GET /auth/login - Pagina de login
 */
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/');
    }

    // Verificăm dacă există utilizatori
    const usersExist = hasUsers();

    res.render('login', {
        title: 'Autentificare',
        needsSetup: !usersExist,
        error: req.query.error
    });
});

/**
 * POST /auth/login - Procesare login
 */
router.post('/login', [
    body('username').trim().notEmpty().withMessage('Username-ul este obligatoriu'),
    body('password').notEmpty().withMessage('Parola este obligatorie')
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.render('login', {
            title: 'Autentificare',
            error: errors.array()[0].msg,
            needsSetup: !hasUsers()
        });
    }

    const { username, password } = req.body;

    try {
        const result = await authenticateUser(username, password);

        if (!result.success) {
            return res.render('login', {
                title: 'Autentificare',
                error: result.error,
                needsSetup: false
            });
        }

        // Setăm sesiunea
        req.session.userId = result.user.id;
        req.session.username = result.user.username;
        req.session.isAdmin = result.user.isAdmin;

        res.redirect('/');
    } catch (error) {
        res.render('login', {
            title: 'Autentificare',
            error: 'Eroare la autentificare',
            needsSetup: false
        });
    }
});

/**
 * POST /auth/setup - Creare primul utilizator (admin)
 */
router.post('/setup', [
    body('username').trim().isLength({ min: 3 }).withMessage('Username-ul trebuie să aibă minim 3 caractere'),
    body('password').isLength({ min: 8 }).withMessage('Parola trebuie să aibă minim 8 caractere'),
    body('confirmPassword').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Parolele nu coincid');
        }
        return true;
    })
], async (req, res) => {
    // Verificăm dacă există deja utilizatori
    if (hasUsers()) {
        return res.redirect('/auth/login?error=Setup deja completat');
    }

    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.render('login', {
            title: 'Setup Inițial',
            error: errors.array()[0].msg,
            needsSetup: true
        });
    }

    const { username, password } = req.body;

    try {
        // Creăm primul utilizator ca admin
        await createUser(username, password, true);

        // Autentificăm automat
        const result = await authenticateUser(username, password);

        if (result.success) {
            req.session.userId = result.user.id;
            req.session.username = result.user.username;
            req.session.isAdmin = result.user.isAdmin;
        }

        res.redirect('/');
    } catch (error) {
        res.render('login', {
            title: 'Setup Inițial',
            error: error.message,
            needsSetup: true
        });
    }
});

/**
 * GET /auth/logout - Deconectare
 */
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/auth/login');
    });
});

/**
 * POST /auth/change-password - Schimbare parolă
 */
router.post('/change-password', requireAuth, [
    body('currentPassword').notEmpty().withMessage('Parola actuală este obligatorie'),
    body('newPassword').isLength({ min: 8 }).withMessage('Parola nouă trebuie să aibă minim 8 caractere'),
    body('confirmNewPassword').custom((value, { req }) => {
        if (value !== req.body.newPassword) {
            throw new Error('Parolele noi nu coincid');
        }
        return true;
    })
], async (req, res) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { currentPassword, newPassword } = req.body;

    try {
        await changePassword(req.session.userId, currentPassword, newPassword);
        res.json({ success: true, message: 'Parola a fost schimbată cu succes' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
