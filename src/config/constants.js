/**
 * ================================================================
 * CONSTANTE APLICAȚIE - CERTIFICATE GARANȚIE PREMIERKIDS
 * ================================================================
 *
 * ATENȚIE CRITICĂ - SMARTBILL API:
 * ================================================================
 * Această aplicație este configurată EXCLUSIV pentru operațiuni
 * READ-ONLY (doar citire) din SmartBill API.
 *
 * NU SE VOR IMPLEMENTA NICIODATĂ operațiuni de:
 * - Creare facturi
 * - Modificare facturi
 * - Ștergere facturi
 * - Creare/modificare/ștergere produse în SmartBill
 * - Orice altă operațiune care modifică date în SmartBill
 *
 * Singurele endpoint-uri permise sunt cele de CITIRE:
 * - GET /products (citire nomenclator)
 * - GET /invoices (citire facturi)
 * - GET /invoice (citire detalii factură)
 * ================================================================
 */

module.exports = {
    // Configurare SmartBill API
    SMARTBILL: {
        BASE_URL: 'https://ws.smartbill.ro/SBORO/api',

        // ENDPOINT-URI PERMISE (READ-ONLY)
        ALLOWED_ENDPOINTS: {
            GET_PRODUCTS: '/products',
            GET_INVOICES: '/invoice',
            GET_INVOICE_PDF: '/invoice/pdf',
            GET_STOCK: '/stocks'
        },

        // IMPORTANT: Lista metodelor HTTP permise
        ALLOWED_METHODS: ['GET'],

        // Rate limiting pentru API
        RATE_LIMIT: {
            MAX_REQUESTS_PER_MINUTE: 60,
            DELAY_BETWEEN_REQUESTS_MS: 500
        }
    },

    // Configurare eMAG Marketplace API
    EMAG: {
        BASE_URL: 'https://marketplace.emag.ro/api-3',

        // Endpoint pentru încărcare documente
        ENDPOINTS: {
            UPLOAD_DOCUMENT: '/order/attachments/save'
        }
    },

    // Câmpuri PDF Template
    PDF_TEMPLATE_FIELDS: {
        PRODUCTS_1: 'Products_1',
        PRODUCTS_2: 'Products_2',
        PRODUCTS_3: 'Products_3',
        WARRANTY_TERMS: 'warranty_terms',
        CLIENT_NAME: 'client_name',
        INVOICE_NO: 'invoice_no',
        INVOICE_DATE: 'invoice_date',
        TENSION_VALUE: 'tensiion_value'
    },

    // Configurare sesiuni
    SESSION: {
        MAX_AGE: 8 * 60 * 60 * 1000, // 8 ore
        COOKIE_NAME: 'garantie_session'
    },

    // Configurare bază de date
    DATABASE: {
        PATH: './data/database.db'
    },

    // Configurare fișiere
    FILES: {
        CREDENTIALS_PATH: './data/credentials.enc',
        PDF_TEMPLATE_PATH: './templates/Certificat de garantie Zulmire v2.pdf',
        WORD_TEMPLATE_PATH: './templates/Certificat de garantie Zulmire v2.docx',
        OUTPUT_PATH: './output'
    },

    // Pattern pentru extragere număr comandă eMAG din facturi
    EMAG_ORDER_PATTERN: /Comanda Emag nr\.\s*(\d+)/i,

    // Configurare securitate
    SECURITY: {
        BCRYPT_ROUNDS: 12,
        MIN_PASSWORD_LENGTH: 8,
        SESSION_SECRET_LENGTH: 64
    }
};
