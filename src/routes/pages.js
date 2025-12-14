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
 * GET / - Dashboard principal
 */
router.get('/', requireAuth, addUserLocals, async (req, res) => {
    const newProductsCount = productsService.countNewProducts();
    const lastProcessed = certificatesService.getLastProcessedInvoice();
    const recentCertificates = certificatesService.getCertificatesHistory(10);

    // Verificăm starea configurării
    let smartbillConfigured = false;
    let emagConfigured = false;

    if (credentialsExist()) {
        try {
            const creds = loadCredentials(process.env.ENCRYPTION_KEY);
            smartbillConfigured = !!(creds?.smartbill?.username);
            emagConfigured = !!(creds?.emag?.username);
        } catch (e) { }
    }

    res.render('dashboard', {
        title: 'Dashboard',
        newProductsCount,
        lastProcessed,
        recentCertificates,
        smartbillConfigured,
        emagConfigured
    });
});

/**
 * GET /products - Pagina nomenclator produse
 */
router.get('/products', requireAuth, addUserLocals, (req, res) => {
    res.render('products', {
        title: 'Nomenclator Produse'
    });
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

module.exports = router;
