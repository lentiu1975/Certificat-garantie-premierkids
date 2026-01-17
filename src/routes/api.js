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
 * GET /api/certificates/test-invoice-list - Test pentru a vedea structura facturilor de la SmartBill
 */
router.get('/certificates/test-invoice-list', async (req, res) => {
    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);

        const invoicesResponse = await smartBillService.getInvoices({
            startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // ultimele 7 zile
            endDate: new Date().toISOString().split('T')[0]
        });

        if (!invoicesResponse || !invoicesResponse.list) {
            return res.json({ error: 'Nu s-au găsit facturi', response: invoicesResponse });
        }

        // Returnăm primele 3 facturi pentru a vedea structura
        const sampleInvoices = invoicesResponse.list.slice(0, 3);

        res.json({
            success: true,
            totalInvoices: invoicesResponse.list.length,
            sampleInvoices: sampleInvoices,
            firstInvoiceKeys: sampleInvoices[0] ? Object.keys(sampleInvoices[0]) : []
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/certificates/debug - Diagnostic pentru procesarea facturii (fără generare efectivă)
 */
router.post('/certificates/debug', [
    body('invoiceNumber').trim().notEmpty().withMessage('Numărul facturii este obligatoriu')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        await smartBillService.initialize(process.env.ENCRYPTION_KEY);

        const invoiceParserService = require('../services/invoice-parser');
        const invoiceIdentifier = req.body.invoiceNumber.trim().toUpperCase();

        // Parsăm identificatorul
        let series, number;
        const seriesWithYearMatch = invoiceIdentifier.match(/^([A-Z]+)(\d{4})(\d{4,6})$/);
        if (seriesWithYearMatch) {
            series = seriesWithYearMatch[1] + seriesWithYearMatch[2];
            number = seriesWithYearMatch[3];
        } else {
            const simpleMatch = invoiceIdentifier.match(/^([A-Z]{2,5})(\d+)$/);
            if (simpleMatch) {
                series = simpleMatch[1];
                number = simpleMatch[2];
            }
        }

        if (!series || !number) {
            return res.status(400).json({ error: 'Format factură invalid' });
        }

        // Descărcăm PDF-ul
        const pdfBuffer = await smartBillService.getInvoicePdf(series, number);

        // Parsăm PDF-ul
        const parseResult = await invoiceParserService.parseInvoicePdf(pdfBuffer);

        if (!parseResult.success) {
            return res.status(400).json({ error: parseResult.error });
        }

        // Potrivim produsele cu nomenclatorul
        const matchedProducts = invoiceParserService.matchProductsWithNomenclator(
            parseResult.data.products,
            productsService
        );

        // Căutăm produsul după cod în nomenclator pentru a vedea ce găsim
        const nomenclatorLookup = {};
        for (const product of parseResult.data.products) {
            const localProduct = productsService.getProductByCode(product.code);
            nomenclatorLookup[product.code] = localProduct ? {
                smartbill_code: localProduct.smartbill_code,
                smartbill_name: localProduct.smartbill_name,
                display_name: localProduct.display_name,
                is_active: localProduct.is_active
            } : null;
        }

        res.json({
            success: true,
            invoiceNumber: `${series}${number}`,
            parsedData: {
                invoiceNumber: parseResult.data.invoiceNumber,
                invoiceDate: parseResult.data.invoiceDate,
                clientName: parseResult.data.clientName,
                isVatPayer: parseResult.data.isVatPayer,
                products: parseResult.data.products,
                emagOrderNumber: parseResult.data.emagOrderNumber
            },
            matchedProducts: matchedProducts,
            nomenclatorLookup: nomenclatorLookup,
            rawTextPreview: parseResult.data.rawText ? parseResult.data.rawText.substring(0, 2000) : null
        });
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

// ============================================
// MANAGEMENT UTILIZATORI
// ============================================

const {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    resetPassword,
    deleteUser
} = require('../middleware/auth');

/**
 * GET /api/users - Lista utilizatori (doar admin)
 */
router.get('/users', requireAdmin, (req, res) => {
    const users = getAllUsers();
    res.json({ success: true, users });
});

/**
 * POST /api/users - Creare utilizator nou (doar admin)
 */
router.post('/users', requireAdmin, [
    body('username').trim().isLength({ min: 3 }).withMessage('Username-ul trebuie să aibă minim 3 caractere'),
    body('password').isLength({ min: 8 }).withMessage('Parola trebuie să aibă minim 8 caractere'),
    body('isAdmin').optional().isBoolean().withMessage('isAdmin trebuie să fie boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }

    try {
        const { username, password, isAdmin } = req.body;
        const result = await createUser(username, password, isAdmin || false);
        const user = getUserById(result.userId);
        res.json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/users/:id - Editare utilizator (doar admin)
 */
router.put('/users/:id', requireAdmin, [
    body('username').optional().trim().isLength({ min: 3 }).withMessage('Username-ul trebuie să aibă minim 3 caractere'),
    body('isAdmin').optional().isBoolean().withMessage('isAdmin trebuie să fie boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }

    try {
        const user = await updateUser(parseInt(req.params.id), req.body);
        res.json({ success: true, user });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/users/:id/reset-password - Resetare parolă (doar admin)
 */
router.post('/users/:id/reset-password', requireAdmin, [
    body('newPassword').isLength({ min: 8 }).withMessage('Parola trebuie să aibă minim 8 caractere')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
    }

    try {
        await resetPassword(parseInt(req.params.id), req.body.newPassword);
        res.json({ success: true, message: 'Parola a fost resetată cu succes' });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/users/:id - Ștergere utilizator (doar admin)
 */
router.delete('/users/:id', requireAdmin, (req, res) => {
    try {
        const result = deleteUser(parseInt(req.params.id), req.session.userId);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// ============================================
// MODUL PREȚURI - Canale de Vânzare
// ============================================

const priceChannelsService = require('../services/price-channels');
const productGroupsService = require('../services/product-groups');
const pricesService = require('../services/prices');
const exchangeRatesService = require('../services/exchange-rates');

/**
 * GET /api/price-channels - Listă canale de vânzare
 */
router.get('/price-channels', (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const channels = priceChannelsService.getAllChannels(includeInactive);
    res.json({ channels, count: channels.length });
});

/**
 * POST /api/price-channels - Adaugă canal nou
 */
router.post('/price-channels', requireAdmin, [
    body('name').trim().notEmpty().withMessage('Numele canalului este obligatoriu'),
    body('currency').isIn(['RON', 'EUR', 'HUF', 'USD']).withMessage('Valută invalidă'),
    body('vat_rate').isFloat({ min: 0, max: 100 }).withMessage('TVA trebuie să fie între 0 și 100')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const channel = priceChannelsService.createChannel(req.body);
        res.json({ success: true, channel });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/price-channels/:id - Editează canal
 */
router.put('/price-channels/:id', requireAdmin, [
    body('name').optional().trim().notEmpty().withMessage('Numele nu poate fi gol'),
    body('currency').optional().isIn(['RON', 'EUR', 'HUF', 'USD']).withMessage('Valută invalidă'),
    body('vat_rate').optional().isFloat({ min: 0, max: 100 }).withMessage('TVA trebuie să fie între 0 și 100')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const channel = priceChannelsService.updateChannel(parseInt(req.params.id), req.body);
        res.json({ success: true, channel });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/price-channels/:id - Dezactivează canal
 */
router.delete('/price-channels/:id', requireAdmin, (req, res) => {
    try {
        const result = priceChannelsService.deleteChannel(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * PUT /api/price-channels/:id/activate - Reactivează canal
 */
router.put('/price-channels/:id/activate', requireAdmin, (req, res) => {
    try {
        const channel = priceChannelsService.activateChannel(parseInt(req.params.id));
        res.json({ success: true, channel });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

/**
 * PUT /api/price-channels/reorder - Reordonare canale
 */
router.put('/price-channels/reorder', requireAdmin, [
    body('orderedIds').isArray().withMessage('Lista de ID-uri este obligatorie')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const channels = priceChannelsService.reorderChannels(req.body.orderedIds);
        res.json({ success: true, channels });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/price-channels/seed - Inserează canalele implicite
 */
router.post('/price-channels/seed', requireAdmin, (req, res) => {
    try {
        const result = priceChannelsService.seedDefaultChannels();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// MODUL PREȚURI - Grupuri de Produse
// ============================================

/**
 * GET /api/product-groups - Listă grupuri de produse
 */
router.get('/product-groups', (req, res) => {
    const withPrices = req.query.withPrices === 'true';

    if (withPrices) {
        const groups = pricesService.getAllGroupsWithPrices();
        res.json({ groups, count: groups.length });
    } else {
        const groups = productGroupsService.getAllGroups();
        res.json({ groups, count: groups.length });
    }
});

/**
 * GET /api/product-groups/stats - Statistici grupuri
 */
router.get('/product-groups/stats', (req, res) => {
    const stats = productGroupsService.getStats();
    res.json(stats);
});

/**
 * POST /api/product-groups/generate - Generare automată grupuri din produse
 */
router.post('/product-groups/generate', requireAdmin, (req, res) => {
    try {
        const result = productGroupsService.generateGroupsFromProducts();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/product-groups/:id - Obține un grup
 */
router.get('/product-groups/:id', (req, res) => {
    const group = productGroupsService.getGroupById(parseInt(req.params.id));
    if (!group) {
        return res.status(404).json({ error: 'Grupul nu a fost găsit' });
    }

    const prices = pricesService.getPricesByGroup(group.id);
    res.json({ group, prices });
});

/**
 * PUT /api/product-groups/:id - Editare grup
 */
router.put('/product-groups/:id', [
    body('group_name').optional().trim().notEmpty().withMessage('Numele grupului nu poate fi gol'),
    body('base_price').optional().isFloat({ min: 0 }).withMessage('Prețul de bază trebuie să fie pozitiv')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const group = productGroupsService.updateGroup(parseInt(req.params.id), req.body);
        res.json({ success: true, group });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/product-groups/:id/prices - Salvare prețuri pentru un grup
 */
router.post('/product-groups/:id/prices', [
    body('prices').isArray().withMessage('Lista de prețuri este obligatorie')
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const results = pricesService.setBulkPrices(parseInt(req.params.id), req.body.prices);
        res.json({ success: true, updated: results.length });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/product-groups/:id - Ștergere grup
 */
router.delete('/product-groups/:id', requireAdmin, (req, res) => {
    try {
        const result = productGroupsService.deleteGroup(parseInt(req.params.id));
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/product-groups/:id/products - Produsele dintr-un grup
 */
router.get('/product-groups/:id/products', (req, res) => {
    try {
        const products = productGroupsService.getProductsForGroup(parseInt(req.params.id));
        res.json({ products, count: products.length });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// MODUL PREȚURI - Curs Valutar
// ============================================

/**
 * GET /api/exchange-rates - Cursuri valutare curente
 */
router.get('/exchange-rates', (req, res) => {
    const rates = exchangeRatesService.getCurrentRates();
    res.json({ rates });
});

/**
 * POST /api/exchange-rates/fetch - Preia cursuri de la BNR
 */
router.post('/exchange-rates/fetch', requireAdmin, async (req, res) => {
    try {
        const result = await exchangeRatesService.fetchFromBnr();
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/exchange-rates/history/:currency - Istoric curs valutar
 */
router.get('/exchange-rates/history/:currency', (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const history = exchangeRatesService.getRatesHistory(req.params.currency, days);
    res.json({ currency: req.params.currency, history });
});

// ============================================
// MODUL PREȚURI - Import/Export
// ============================================

/**
 * GET /api/prices/export - Export prețuri în CSV
 */
router.get('/prices/export', (req, res) => {
    try {
        const csv = pricesService.exportToCsv();

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="preturi_${new Date().toISOString().split('T')[0]}.csv"`);
        res.send('\ufeff' + csv); // BOM pentru Excel
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/prices/import - Import prețuri din CSV
 */
router.post('/prices/import', requireAdmin, (req, res) => {
    try {
        const { csvData } = req.body;

        if (!csvData) {
            return res.status(400).json({ error: 'Date CSV lipsă' });
        }

        const result = pricesService.importFromCsv(csvData);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

/**
 * GET /api/prices/stats - Statistici prețuri
 */
router.get('/prices/stats', (req, res) => {
    const stats = pricesService.getStats();
    res.json(stats);
});

/**
 * GET /api/prices/expired - Prețuri expirate
 */
router.get('/prices/expired', (req, res) => {
    const expired = pricesService.getExpiredPrices();
    const expiringSoon = pricesService.getExpiringSoonPrices(7);
    res.json({ expired, expiringSoon });
});

module.exports = router;
