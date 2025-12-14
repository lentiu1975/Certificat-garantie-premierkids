/**
 * Rute API pentru operațiuni backend
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { saveCredentials, loadCredentials, credentialsExist } = require('../utils/encryption');
const smartBillService = require('../services/smartbill');
const emagService = require('../services/emag');
const productsService = require('../services/products');
const certificatesService = require('../services/certificates');
const { db } = require('../config/database');

// Toate rutele API necesită autentificare
router.use(requireAuth);

// ============================================
// CREDENȚIALE API
// ============================================

/**
 * GET /api/credentials/status - Verifică starea credențialelor (cu detalii parțiale)
 */
router.get('/credentials/status', (req, res) => {
    const hasCredentials = credentialsExist();

    let smartbillConfigured = false;
    let emagConfigured = false;
    let smartbillInfo = null;
    let emagInfo = null;

    if (hasCredentials) {
        try {
            const creds = loadCredentials(process.env.ENCRYPTION_KEY);
            smartbillConfigured = !!(creds?.smartbill?.username && creds?.smartbill?.token);
            emagConfigured = !!(creds?.emag?.username && creds?.emag?.password);

            // Returnăm informații parțiale (fără token/parolă) pentru afișare
            if (creds?.smartbill) {
                smartbillInfo = {
                    username: creds.smartbill.username || '',
                    cif: creds.smartbill.cif || '',
                    hasToken: !!creds.smartbill.token
                };
            }
            if (creds?.emag) {
                emagInfo = {
                    username: creds.emag.username || '',
                    hasPassword: !!creds.emag.password
                };
            }
        } catch (e) {
            // Eroare la decriptare
        }
    }

    res.json({
        hasCredentials,
        smartbillConfigured,
        emagConfigured,
        smartbill: smartbillInfo,
        emag: emagInfo
    });
});

/**
 * POST /api/credentials/smartbill - Salvare credențiale SmartBill
 */
router.post('/credentials/smartbill', requireAdmin, [
    body('username').trim().notEmpty().withMessage('Email-ul SmartBill este obligatoriu'),
    body('cif').trim().notEmpty().withMessage('CIF-ul este obligatoriu')
    // Token-ul nu mai este obligatoriu - se păstrează cel vechi dacă nu se trimite unul nou
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, token, cif } = req.body;

    try {
        // Încărcăm credențialele existente sau creăm un obiect nou
        let credentials = {};
        if (credentialsExist()) {
            try {
                credentials = loadCredentials(process.env.ENCRYPTION_KEY) || {};
            } catch (e) {
                credentials = {};
            }
        }

        // Păstrăm token-ul vechi dacă nu s-a trimis unul nou
        const existingToken = credentials.smartbill?.token;
        const newToken = token && token.trim() ? token.trim() : existingToken;

        if (!newToken) {
            return res.status(400).json({ error: 'Token-ul API este obligatoriu pentru prima configurare' });
        }

        // Actualizăm credențialele SmartBill
        credentials.smartbill = { username, token: newToken, cif };

        // Salvăm criptat
        saveCredentials(credentials, process.env.ENCRYPTION_KEY);

        // Testăm conexiunea
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);

        res.json({ success: true, message: 'Credențiale SmartBill salvate cu succes' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/credentials/emag - Salvare credențiale eMAG
 */
router.post('/credentials/emag', requireAdmin, [
    body('username').trim().notEmpty().withMessage('Username-ul eMAG este obligatoriu'),
    body('password').trim().notEmpty().withMessage('Parola eMAG este obligatorie')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, password } = req.body;

    try {
        let credentials = {};
        if (credentialsExist()) {
            try {
                credentials = loadCredentials(process.env.ENCRYPTION_KEY) || {};
            } catch (e) {
                credentials = {};
            }
        }

        credentials.emag = { username, password };

        saveCredentials(credentials, process.env.ENCRYPTION_KEY);

        res.json({ success: true, message: 'Credențiale eMAG salvate cu succes' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/credentials/test-smartbill - Testare conexiune SmartBill
 */
router.post('/credentials/test-smartbill', async (req, res) => {
    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);
        const products = await smartBillService.getProducts();

        res.json({
            success: true,
            message: `Conexiune reușită! ${products.list?.length || 0} produse găsite.`
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/credentials/test-emag - Testare conexiune eMAG
 */
router.post('/credentials/test-emag', async (req, res) => {
    try {
        await emagService.initialize(process.env.ENCRYPTION_KEY);
        const result = await emagService.testConnection();

        if (result.success) {
            res.json({ success: true, message: 'Conexiune eMAG reușită!' });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// NOMENCLATOR PRODUSE
// ============================================

/**
 * GET /api/products - Obține toate produsele
 */
router.get('/products', (req, res) => {
    const includeInactive = req.query.includeInactive !== 'false';
    const products = productsService.getAllProducts(includeInactive);
    const newCount = productsService.countNewProducts();

    res.json({
        products,
        total: products.length,
        newCount
    });
});

/**
 * GET /api/products/new - Obține doar produsele noi
 */
router.get('/products/new', (req, res) => {
    const products = productsService.getNewProducts();
    res.json({ products, count: products.length });
});

/**
 * POST /api/products/sync - Sincronizare produse din SmartBill
 */
router.post('/products/sync', async (req, res) => {
    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);
        const result = await productsService.syncProducts();

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/products/:id - Actualizare produs
 */
router.put('/products/:id', [
    body('warranty_pf').isInt({ min: 0 }).withMessage('Garanție PF trebuie să fie un număr pozitiv'),
    body('warranty_pj').isInt({ min: 0 }).withMessage('Garanție PJ trebuie să fie un număr pozitiv'),
    body('is_active').isBoolean().withMessage('Starea activă trebuie să fie boolean'),
    body('voltage_supply').trim().notEmpty().withMessage('Tensiunea de alimentare este obligatorie'),
    body('voltage_min').trim().notEmpty().withMessage('Tensiunea minimă este obligatorie')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { id } = req.params;

    try {
        productsService.updateProduct(parseInt(id), req.body);
        res.json({ success: true, message: 'Produs actualizat cu succes' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/products/auto-fill - Auto-completare produse bazat pe reguli
 */
router.post('/products/auto-fill', requireAdmin, (req, res) => {
    try {
        const result = productsService.autoFillProducts();
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/products/bulk-update - Actualizare în masă
 */
router.post('/products/bulk-update', (req, res) => {
    const { products } = req.body;

    if (!Array.isArray(products)) {
        return res.status(400).json({ error: 'Lista de produse este invalidă' });
    }

    try {
        const results = productsService.bulkUpdateProducts(products);
        const successCount = results.filter(r => r.success).length;

        res.json({
            success: true,
            message: `${successCount} din ${products.length} produse actualizate`,
            results
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CERTIFICATE GARANȚIE
// ============================================

/**
 * GET /api/certificates - Istoric certificate
 */
router.get('/certificates', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const certificates = certificatesService.getCertificatesHistory(limit, offset);
    res.json({ certificates, count: certificates.length });
});

/**
 * GET /api/certificates/last-processed - Ultima factură procesată
 */
router.get('/certificates/last-processed', (req, res) => {
    const lastProcessed = certificatesService.getLastProcessedInvoice();
    res.json({ lastProcessedInvoice: lastProcessed });
});

/**
 * PUT /api/certificates/last-processed - Setare ultima factură procesată
 */
router.put('/certificates/last-processed', requireAdmin, [
    body('invoiceNumber').trim().notEmpty().withMessage('Numărul facturii este obligatoriu')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        certificatesService.setLastProcessedInvoice(req.body.invoiceNumber);
        res.json({ success: true, message: 'Ultima factură procesată actualizată' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/certificates/process-auto - Procesare automată facturi
 */
router.post('/certificates/process-auto', async (req, res) => {
    const { startDate, endDate, maxInvoices } = req.body;

    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);
        await emagService.initialize(process.env.ENCRYPTION_KEY);

        const result = await certificatesService.processUnprocessedInvoices({
            startDate,
            endDate,
            maxInvoices: maxInvoices || 50
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/certificates/generate-single - Generare certificat pentru factură specifică (folosind SmartBill API)
 * NOTĂ: SmartBill API nu permite citirea detaliilor facturii, doar PDF și status plăți
 */
router.post('/certificates/generate-single', [
    body('invoiceNumber').trim().notEmpty().withMessage('Numărul facturii este obligatoriu')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);
        await emagService.initialize(process.env.ENCRYPTION_KEY);

        const result = await certificatesService.generateSingleCertificate(req.body.invoiceNumber);

        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/certificates/generate-manual - Generare certificat cu date introduse manual
 */
router.post('/certificates/generate-manual', [
    body('invoiceNumber').trim().notEmpty().withMessage('Numărul facturii este obligatoriu'),
    body('invoiceDate').trim().notEmpty().withMessage('Data facturii este obligatorie'),
    body('clientName').trim().notEmpty().withMessage('Numele clientului este obligatoriu'),
    body('products').isArray({ min: 1 }).withMessage('Selectați cel puțin un produs')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const result = await certificatesService.generateManualCertificate(req.body);

        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/certificates/:id/download - Descărcare certificat (PDF sau DOCX)
 */
router.get('/certificates/:invoiceNumber/download', async (req, res) => {
    const { invoiceNumber } = req.params;
    const pdfService = require('../services/pdf');

    try {
        const docBuffer = await certificatesService.getCertificatePdf(invoiceNumber);

        if (!docBuffer) {
            return res.status(404).json({ error: 'Certificatul nu a fost găsit' });
        }

        // Determinăm tipul fișierului (PDF sau DOCX)
        const extension = pdfService.getCertificateExtension(invoiceNumber);

        if (extension === 'pdf') {
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Certificat_Garantie_${invoiceNumber}.pdf"`);
        } else {
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="Certificat_Garantie_${invoiceNumber}.docx"`);
        }

        res.send(docBuffer);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// CONFIGURARE
// ============================================

/**
 * GET /api/config/:key - Obține o valoare de configurare
 */
router.get('/config/:key', (req, res) => {
    const { key } = req.params;
    const stmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
    const result = stmt.get(key);

    res.json({ key, value: result?.value || null });
});

/**
 * PUT /api/config/:key - Setează o valoare de configurare
 */
router.put('/config/:key', requireAdmin, (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    const stmt = db.prepare(`
        INSERT INTO app_config (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(key, value, value);
    res.json({ success: true });
});

module.exports = router;
