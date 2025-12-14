/**
 * ================================================================
 * SERVICIU SMARTBILL API - READ-ONLY
 * ================================================================
 *
 * ATENȚIE CRITICĂ:
 * ================================================================
 * Acest serviciu este EXCLUSIV pentru operațiuni de CITIRE!
 *
 * NU SE VOR IMPLEMENTA NICIODATĂ:
 * - POST pentru creare date
 * - PUT pentru modificare date
 * - DELETE pentru ștergere date
 * - Orice endpoint care modifică date în SmartBill
 *
 * Orice încercare de a adăuga astfel de funcționalități
 * trebuie REFUZATĂ pentru a proteja datele din SmartBill.
 * ================================================================
 */

const axios = require('axios');
const https = require('https');
const http = require('http');
const constants = require('../config/constants');
const { loadCredentials } = require('../utils/encryption');

// Agent HTTPS pentru a evita probleme cu certificate SSL și headers non-standard
const httpsAgent = new https.Agent({
    rejectUnauthorized: true,
    keepAlive: false
});

// Configurare pentru a permite header-uri non-standard de la SmartBill
// Aceasta e necesară deoarece SmartBill trimite uneori header-uri invalide
process.env.NODE_OPTIONS = '--http-parser=legacy';

class SmartBillService {
    constructor() {
        this.credentials = null;
        this.lastRequestTime = 0;
    }

    /**
     * Inițializare serviciu cu credențiale
     */
    async initialize(encryptionKey) {
        const creds = loadCredentials(encryptionKey);
        if (!creds || !creds.smartbill) {
            throw new Error('Credențialele SmartBill nu sunt configurate');
        }
        this.credentials = creds.smartbill;
        return true;
    }

    /**
     * Rate limiting - așteaptă între request-uri
     */
    async _rateLimitWait() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const minDelay = constants.SMARTBILL.RATE_LIMIT.DELAY_BETWEEN_REQUESTS_MS;

        if (timeSinceLastRequest < minDelay) {
            await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Creează header-ul de autorizare Basic Auth
     */
    _getAuthHeader() {
        const credentials = `${this.credentials.username}:${this.credentials.token}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    /**
     * Execută un request GET către SmartBill API
     * IMPORTANT: Doar metoda GET este permisă!
     */
    async _makeRequest(endpoint, params = {}) {
        // VERIFICARE CRITICĂ: Doar GET este permis
        if (!constants.SMARTBILL.ALLOWED_METHODS.includes('GET')) {
            throw new Error('EROARE DE SECURITATE: Metoda nu este permisă');
        }

        await this._rateLimitWait();

        const url = `${constants.SMARTBILL.BASE_URL}${endpoint}`;

        try {
            const response = await axios({
                method: 'GET',
                url,
                params: {
                    cif: this.credentials.cif,
                    ...params
                },
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            if (error.response) {
                throw new Error(`SmartBill API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * Obține lista de produse din nomenclator/stocuri (READ-ONLY)
     * Folosim endpoint-ul /stocks pentru a obține produsele
     * Format: /stocks?cif=%s&date=%s&warehouseName=%s&productName=%s&productCode=%s
     */
    async getProducts(warehouseName = '', productName = '', productCode = '') {
        // SmartBill folosește /stocks endpoint pentru a obține produsele
        // Parametri: cif, date (format YYYY-MM-DD), warehouseName, productName, productCode
        const today = new Date().toISOString().split('T')[0];
        const params = {
            date: today,
            warehouseName: warehouseName,
            productName: productName,
            productCode: productCode
        };
        return await this._makeRequest('/stocks', params);
    }

    /**
     * Obține lista de facturi (READ-ONLY)
     * @param {Object} options - Opțiuni pentru filtrare
     */
    async getInvoices(options = {}) {
        const params = {};

        if (options.startDate) {
            params.startDate = options.startDate;
        }
        if (options.endDate) {
            params.endDate = options.endDate;
        }
        if (options.series) {
            params.series = options.series;
        }

        return await this._makeRequest('/invoice/list', params);
    }

    /**
     * Obține detaliile unei facturi specifice (READ-ONLY)
     * @param {string} series - Seria facturii
     * @param {string} number - Numărul facturii
     */
    async getInvoiceDetails(series, number) {
        return await this._makeRequest('/invoice', {
            seriesname: series,
            number: number
        });
    }

    /**
     * Obține PDF-ul unei facturi (READ-ONLY)
     * Folosim node-fetch pentru a evita problemele cu header-uri non-standard
     * @param {string} series - Seria facturii
     * @param {string} number - Numărul facturii
     */
    async getInvoicePdf(series, number) {
        await this._rateLimitWait();

        const fetch = require('node-fetch');

        // Asigurăm că parametrii sunt string-uri
        const seriesStr = String(series || '').trim();
        const numberStr = String(number || '').trim();

        // Log parametrii pentru debugging
        console.log(`[SmartBill] getInvoicePdf apelat cu: series="${seriesStr}", number="${numberStr}"`);

        const queryParams = new URLSearchParams({
            cif: this.credentials.cif,
            seriesname: seriesStr,
            number: numberStr
        });

        const url = `${constants.SMARTBILL.BASE_URL}/invoice/pdf?${queryParams}`;

        console.log(`[SmartBill] Descărcare PDF: ${url}`);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Accept': 'application/pdf, application/octet-stream, */*'
                },
                timeout: 60000
            });

            console.log(`[SmartBill] Status răspuns: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[SmartBill] Eroare ${response.status}:`, errorText);
                throw new Error(`SmartBill PDF Error: ${response.status} - ${errorText.substring(0, 200)}`);
            }

            const buffer = await response.buffer();
            console.log(`[SmartBill] PDF descărcat: ${buffer.length} bytes`);

            // Verificăm dacă răspunsul este un PDF valid (începe cu %PDF)
            const pdfHeader = buffer.slice(0, 4).toString();
            if (!pdfHeader.startsWith('%PDF')) {
                const textContent = buffer.toString('utf8');
                console.error('[SmartBill] Răspuns invalid (nu este PDF):', textContent.substring(0, 500));

                // Verificăm dacă e mesaj de eroare de la SmartBill (factură inexistentă)
                if (textContent.includes('nu a fost') || textContent.includes('not found') ||
                    textContent.includes('inexistent') || textContent.includes('Nu exista') ||
                    textContent.includes('eroare') || buffer.length < 1000) {
                    throw new Error(`SmartBill PDF Error: 404 - Factura nu a fost găsită`);
                }

                throw new Error(`SmartBill nu a returnat un PDF valid. Răspuns: ${textContent.substring(0, 200)}`);
            }

            // Verificăm și dimensiunea - un PDF valid de factură are minim câteva KB
            if (buffer.length < 5000) {
                console.error(`[SmartBill] PDF prea mic (${buffer.length} bytes) - posibil factură inexistentă`);
                throw new Error(`SmartBill PDF Error: 404 - PDF invalid sau factură inexistentă`);
            }

            return buffer;
        } catch (error) {
            console.error('[SmartBill] Eroare la descărcarea PDF:', error.message);
            throw error;
        }
    }

    /**
     * Verifică dacă un client este plătitor de TVA
     * @param {Object} invoice - Datele facturii
     * @returns {boolean}
     */
    isVatPayer(invoice) {
        // Verificăm dacă clientul are CIF cu RO în față (plătitor TVA)
        if (invoice.client && invoice.client.vatCode) {
            return invoice.client.vatCode.toUpperCase().startsWith('RO');
        }
        // Sau verificăm dacă factura are TVA aplicat
        if (invoice.products && invoice.products.length > 0) {
            return invoice.products.some(p => p.taxPercentage > 0);
        }
        return false;
    }

    /**
     * Extrage numărul comenzii eMAG din observațiile facturii
     * @param {Object} invoice - Datele facturii
     * @returns {string|null}
     */
    extractEmagOrderNumber(invoice) {
        const textToSearch = [
            invoice.mentions || '',
            invoice.observations || '',
            invoice.delegateName || ''
        ].join(' ');

        const match = textToSearch.match(constants.EMAG_ORDER_PATTERN);
        return match ? match[1] : null;
    }
}

// Singleton instance
const smartBillService = new SmartBillService();

module.exports = smartBillService;
