/**
 * Serviciu pentru integrare eMAG Marketplace API
 * Folosit pentru încărcarea certificatelor de garanție
 */

const axios = require('axios');
const FormData = require('form-data');
const constants = require('../config/constants');
const { loadCredentials } = require('../utils/encryption');

class EmagService {
    constructor() {
        this.credentials = null;
    }

    /**
     * Inițializare serviciu cu credențiale
     */
    async initialize(encryptionKey) {
        const creds = loadCredentials(encryptionKey);
        if (!creds || !creds.emag) {
            return false; // eMAG nu este configurat, nu e obligatoriu
        }
        this.credentials = creds.emag;
        return true;
    }

    /**
     * Verifică dacă serviciul este configurat
     */
    isConfigured() {
        return this.credentials !== null;
    }

    /**
     * Creează header-ul de autorizare Basic Auth pentru eMAG
     */
    _getAuthHeader() {
        const credentials = `${this.credentials.username}:${this.credentials.password}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    /**
     * Încarcă un certificat de garanție pentru o comandă eMAG
     * @param {string} orderNumber - Numărul comenzii eMAG
     * @param {Buffer} pdfBuffer - Buffer-ul PDF
     * @param {string} filename - Numele fișierului
     */
    async uploadWarrantyCertificate(orderNumber, pdfBuffer, filename) {
        if (!this.isConfigured()) {
            throw new Error('Serviciul eMAG nu este configurat');
        }

        const url = `${constants.EMAG.BASE_URL}${constants.EMAG.ENDPOINTS.UPLOAD_DOCUMENT}`;

        // Convertim PDF-ul în base64
        const base64Pdf = pdfBuffer.toString('base64');

        const payload = {
            order_id: parseInt(orderNumber),
            attachments: [
                {
                    name: filename,
                    type: 'application/pdf',
                    content: base64Pdf
                }
            ]
        };

        try {
            const response = await axios({
                method: 'POST',
                url,
                data: payload,
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            });

            if (response.data && response.data.isError === false) {
                return {
                    success: true,
                    message: 'Certificat încărcat cu succes în eMAG'
                };
            }

            return {
                success: false,
                error: response.data?.messages || 'Eroare necunoscută la încărcare'
            };
        } catch (error) {
            if (error.response) {
                return {
                    success: false,
                    error: `eMAG API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`
                };
            }
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verifică validitatea credențialelor eMAG
     */
    async testConnection() {
        if (!this.isConfigured()) {
            return { success: false, error: 'Credențiale neconfigured' };
        }

        try {
            // Facem un request simplu pentru a verifica autentificarea
            const url = `${constants.EMAG.BASE_URL}/order/count`;

            const response = await axios({
                method: 'POST',
                url,
                data: {},
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            return { success: true, message: 'Conexiune eMAG validă' };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.messages || error.message
            };
        }
    }
}

// Singleton instance
const emagService = new EmagService();

module.exports = emagService;
