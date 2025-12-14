/**
 * ================================================================
 * SERVER PRINCIPAL - CERTIFICATE GARANȚIE PREMIERKIDS
 * ================================================================
 *
 * ATENȚIE CRITICĂ - SMARTBILL API:
 * Această aplicație este configurată EXCLUSIV pentru operațiuni
 * READ-ONLY (doar citire) din SmartBill API.
 * NU se vor implementa NICIODATĂ operațiuni de scriere!
 * ================================================================
 */

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const { initializeDatabase } = require('./config/database');
const constants = require('./config/constants');

// Funcție principală async pentru inițializare
async function startServer() {
    // Verificăm variabilele de mediu critice
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
        console.error('EROARE: ENCRYPTION_KEY trebuie să aibă minim 32 de caractere!');
        console.error('Setează variabila în fișierul .env');
        process.exit(1);
    }

    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        console.error('EROARE: SESSION_SECRET trebuie să aibă minim 32 de caractere!');
        console.error('Setează variabila în fișierul .env');
        process.exit(1);
    }

    // Creăm directoarele necesare
    const dirs = ['./data', './data/sessions', './output', './templates'];
    dirs.forEach(dir => {
        const fullPath = path.resolve(dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });

    // Inițializăm baza de date (async pentru sql.js)
    await initializeDatabase();

    // Inițializare Express
    const app = express();

    // Middleware de securitate
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
                fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
                imgSrc: ["'self'", "data:"]
            }
        }
    }));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minute
        max: 500, // maxim 500 request-uri per IP
        message: { error: 'Prea multe cereri. Încercați din nou mai târziu.' }
    });
    app.use(limiter);

    // Rate limiting mai strict pentru login
    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: { error: 'Prea multe încercări de autentificare. Încercați din nou în 15 minute.' }
    });
    app.use('/auth/login', loginLimiter);

    // Parsare body
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Configurare sesiuni cu persistență pe fișiere
    app.use(session({
        store: new FileStore({
            path: './data/sessions',
            ttl: 86400, // 24 ore în secunde
            retries: 0,
            logFn: function() {} // Dezactivăm log-urile verbose
        }),
        secret: process.env.SESSION_SECRET,
        name: constants.SESSION.COOKIE_NAME,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: constants.SESSION.MAX_AGE,
            sameSite: 'lax'
        }
    }));

    // Fișiere statice
    app.use(express.static(path.join(__dirname, 'public')));

    // Template engine - EJS
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Trust proxy pentru deployări în spatele unui reverse proxy
    if (process.env.NODE_ENV === 'production') {
        app.set('trust proxy', 1);
    }

    // Rute - încărcăm după inițializarea DB
    const authRoutes = require('./routes/auth');
    const apiRoutes = require('./routes/api');
    const pageRoutes = require('./routes/pages');

    // Endpoint de debug temporar (fără autentificare) pentru a vedea structura facturilor SmartBill
    app.get('/debug-invoices', async (req, res) => {
        try {
            const smartBillService = require('./services/smartbill');
            await smartBillService.initialize(process.env.ENCRYPTION_KEY);

            const invoicesResponse = await smartBillService.getInvoices({
                startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0]
            });

            if (!invoicesResponse || !invoicesResponse.list) {
                return res.json({ error: 'Nu s-au găsit facturi', response: invoicesResponse });
            }

            const sampleInvoice = invoicesResponse.list[0];
            res.json({
                success: true,
                totalInvoices: invoicesResponse.list.length,
                firstInvoiceKeys: sampleInvoice ? Object.keys(sampleInvoice) : [],
                firstInvoice: sampleInvoice
            });
        } catch (error) {
            res.status(500).json({ error: error.message, stack: error.stack });
        }
    });

    app.use('/auth', authRoutes);
    app.use('/api', apiRoutes);
    app.use('/', pageRoutes);

    // Redirect la login pentru rute neautentificate
    app.get('/login', (req, res) => res.redirect('/auth/login'));

    // Handler erori 404
    app.use((req, res, next) => {
        res.status(404).render('error', {
            title: 'Pagină negăsită',
            message: 'Pagina căutată nu există.',
            error: null
        });
    });

    // Handler erori generale
    app.use((err, req, res, next) => {
        console.error('Eroare server:', err);

        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(500).json({ error: 'Eroare internă server' });
        }

        res.status(500).render('error', {
            title: 'Eroare',
            message: 'A apărut o eroare neașteptată.',
            error: process.env.NODE_ENV === 'development' ? err : null
        });
    });

    // Pornire server
    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => {
        console.log('');
        console.log('================================================================');
        console.log('  CERTIFICATE GARANȚIE PREMIERKIDS');
        console.log('================================================================');
        console.log(`  Server pornit pe portul ${PORT}`);
        console.log(`  URL: http://localhost:${PORT}`);
        console.log('');
        console.log('  IMPORTANT: SmartBill API - DOAR CITIRE (READ-ONLY)');
        console.log('================================================================');
        console.log('');
    });

    return app;
}

// Pornim serverul
startServer().catch(err => {
    console.error('Eroare la pornirea serverului:', err);
    process.exit(1);
});
