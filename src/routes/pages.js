/**
 * Rute pentru paginile aplicației
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const productsService = require('../services/products');
const certificatesService = require('../services/certificates');
const { credentialsExist, loadCredentials } = require('../utils/encryption');

// Middleware pentru a adăuga date comune în toate view-urile (doar pentru rute protejate)
function addUserLocals(req, res, next) {
    res.locals.user = {
        username: req.session.username,
        isAdmin: req.session.isAdmin
    };
    res.locals.newProductsCount = 0; // default
    next();
}

/**
 * GET / - Dashboard principal (Module Launcher)
 */
router.get('/', requireAuth, addUserLocals, async (req, res) => {
    res.render('dashboard', {
        title: 'Dashboard'
    });
});

/**
 * GET /nomenclator - Pagina nomenclator produse (global)
 */
router.get('/nomenclator', requireAuth, addUserLocals, (req, res) => {
    res.render('products', {
        title: 'Nomenclator Produse'
    });
});

/**
 * GET /products - Redirect la nomenclator (backward compatibility)
 */
router.get('/products', requireAuth, (req, res) => {
    res.redirect('/nomenclator');
});

/**
 * GET /certificates - Pagina certificate garanție
 */
router.get('/certificates', requireAuth, addUserLocals, (req, res) => {
    res.render('certificates', {
        title: 'Certificate Garanție'
    });
});

/**
 * GET /certificates/auto - Pagina procesare automată
 */
router.get('/certificates/auto', requireAuth, addUserLocals, (req, res) => {
    const lastProcessed = certificatesService.getLastProcessedInvoice();

    res.render('certificates-auto', {
        title: 'Procesare Automată Certificate',
        lastProcessed
    });
});

/**
 * GET /certificates/manual - Pagina generare manuală
 */
router.get('/certificates/manual', requireAuth, addUserLocals, (req, res) => {
    res.render('certificates-manual', {
        title: 'Generare Certificat Manual'
    });
});

/**
 * GET /settings - Pagina setări
 */
router.get('/settings', requireAuth, requireAdmin, addUserLocals, (req, res) => {
    let smartbillConfigured = false;
    let emagConfigured = false;

    if (credentialsExist()) {
        try {
            const creds = loadCredentials(process.env.ENCRYPTION_KEY);
            smartbillConfigured = !!(creds?.smartbill?.username);
            emagConfigured = !!(creds?.emag?.username);
        } catch (e) { }
    }

    res.render('settings', {
        title: 'Setări',
        smartbillConfigured,
        emagConfigured
    });
});

/**
 * GET /history - Istoric certificate
 */
router.get('/history', requireAuth, addUserLocals, (req, res) => {
    res.render('history', {
        title: 'Istoric Certificate'
    });
});

// ============================================
// MODUL PREȚURI
// ============================================

/**
 * GET /prices - Pagina principală prețuri
 */
router.get('/prices', requireAuth, addUserLocals, (req, res) => {
    res.render('prices', {
        title: 'Prețuri'
    });
});

/**
 * GET /prices/channels - Administrare canale de vânzare
 */
router.get('/prices/channels', requireAuth, requireAdmin, addUserLocals, (req, res) => {
    res.render('price-channels', {
        title: 'Canale de Vânzare'
    });
});

module.exports = router;
