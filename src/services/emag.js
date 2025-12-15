/**
 * Serviciu pentru integrare eMAG Marketplace API
 * Folosit pentru încărcarea certificatelor de garanție
 *
 * Conform documentației eMAG API v4.5.0 - secțiunea 5.1.3 Order invoices and warranties
 */

const axios = require('axios');
const constants = require('../config/constants');
const { loadCredentials } = require('../utils/encryption');

class EmagService {
    constructor() {
        this.credentials = null;
        this.publicBaseUrl = null; // URL-ul public unde sunt accesibile PDF-urile
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
        this.publicBaseUrl = creds.emag.publicBaseUrl || null;
        return true;
    }

    /**
     * Setează URL-ul public pentru accesarea certificatelor
     */
    setPublicBaseUrl(url) {
        this.publicBaseUrl = url;
    }

    /**
     * Verifică dacă serviciul este configurat
     */
    isConfigured() {
        return this.credentials !== null;
    }

    /**
     * Verifică dacă URL-ul public este configurat
     */
    hasPublicUrl() {
        return this.publicBaseUrl !== null;
    }

    /**
     * Creează header-ul de autorizare Basic Auth pentru eMAG
     */
    _getAuthHeader() {
        const credentials = `${this.credentials.username}:${this.credentials.password}`;
        return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    /**
     * Citește detaliile unei comenzi eMAG pentru a obține order_product_id
     * @param {string} orderId - ID-ul comenzii eMAG
     * @returns {Object} - Detaliile comenzii
     */
    async getOrderDetails(orderId) {
        if (!this.isConfigured()) {
            throw new Error('Serviciul eMAG nu este configurat');
        }

        const url = `${constants.EMAG.BASE_URL}/order/read`;

        try {
            const response = await axios({
                method: 'POST',
                url,
                data: {
                    id: parseInt(orderId)
                },
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.isError === false && response.data.results) {
                return {
                    success: true,
                    order: response.data.results[0] || null
                };
            }

            return {
                success: false,
                error: response.data?.messages || 'Comanda nu a fost găsită'
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.messages || error.message
            };
        }
    }

    /**
     * Încarcă un certificat de garanție pentru o comandă eMAG
     * Conform documentației API eMAG v4.5.0 - secțiunea 5.1.3
     *
     * IMPORTANT: PDF-ul trebuie să fie accesibil la un URL public!
     * eMAG nu acceptă upload direct de fișiere, ci doar URL-uri.
     *
     * @param {string} orderId - ID-ul comenzii eMAG
     * @param {number} orderProductId - ID-ul produsului din comandă (din order/read -> products -> id)
     * @param {string} pdfUrl - URL-ul public al PDF-ului
     * @param {string} filename - Numele fișierului (max 60 caractere)
     * @param {number} orderType - Tipul comenzii: 2=fulfilled by eMAG, 3=fulfilled by seller
     */
    async uploadWarrantyCertificate(orderId, orderProductId, pdfUrl, filename = 'Certificat Garantie', orderType = 3) {
        if (!this.isConfigured()) {
            throw new Error('Serviciul eMAG nu este configurat');
        }

        const url = `${constants.EMAG.BASE_URL}/order/attachments/save`;

        // Conform documentației eMAG API v4.5.0
        // type=3 pentru warranty, order_product_id este obligatoriu pentru warranty
        const payload = {
            order_id: parseInt(orderId),
            order_type: orderType, // 3 = fulfilled by seller (default)
            order_product_id: parseInt(orderProductId),
            name: filename.substring(0, 60), // max 60 caractere
            url: pdfUrl,
            type: 3, // 3 = warranty
            force_download: 1 // forțează descărcarea dacă URL-ul s-a schimbat
        };

        console.log('[eMAG] Upload warranty:', JSON.stringify(payload, null, 2));

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

            console.log('[eMAG] Response:', JSON.stringify(response.data, null, 2));

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
            console.error('[eMAG] Error:', error.response?.data || error.message);
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
     * Încarcă certificatul de garanție pentru toate produsele dintr-o comandă
     * @param {string} orderId - ID-ul comenzii eMAG
     * @param {string} pdfUrl - URL-ul public al PDF-ului
     * @param {string} filename - Numele fișierului
     * @param {Array} productIds - Lista de order_product_id pentru care se încarcă garanția (opțional)
     */
    async uploadWarrantyForOrder(orderId, pdfUrl, filename = 'Certificat Garantie', productIds = null) {
        // Mai întâi citim detaliile comenzii pentru a obține produsele
        const orderResult = await this.getOrderDetails(orderId);

        if (!orderResult.success || !orderResult.order) {
            return {
                success: false,
                error: orderResult.error || 'Nu s-a putut citi comanda din eMAG'
            };
        }

        const order = orderResult.order;
        const orderType = order.type || 3; // default fulfilled by seller
        const products = order.products || [];

        if (products.length === 0) {
            return {
                success: false,
                error: 'Comanda nu conține produse'
            };
        }

        const results = [];

        // Dacă sunt specificate productIds, folosim doar acelea
        const targetProducts = productIds
            ? products.filter(p => productIds.includes(p.id))
            : products;

        for (const product of targetProducts) {
            const uploadResult = await this.uploadWarrantyCertificate(
                orderId,
                product.id,
                pdfUrl,
                filename,
                orderType
            );

            results.push({
                productId: product.id,
                productName: product.name || product.part_number,
                ...uploadResult
            });

            // Mică pauză între request-uri
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        const successCount = results.filter(r => r.success).length;

        return {
            success: successCount > 0,
            message: `${successCount}/${results.length} certificate încărcate`,
            results
        };
    }

    /**
     * Generează URL-ul public pentru un certificat
     * @param {string} certificateFilename - Numele fișierului certificat
     */
    getPublicCertificateUrl(certificateFilename) {
        if (!this.publicBaseUrl) {
            return null;
        }
        return `${this.publicBaseUrl}/certificates/${certificateFilename}`;
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

            return {
                success: true,
                message: 'Conexiune eMAG validă',
                orderCount: response.data?.results?.noOfItems || 0
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.messages || error.message
            };
        }
    }

    /**
     * Citește atașamentele existente pentru o comandă
     * @param {string} orderId - ID-ul comenzii
     */
    async getOrderAttachments(orderId) {
        if (!this.isConfigured()) {
            throw new Error('Serviciul eMAG nu este configurat');
        }

        const url = `${constants.EMAG.BASE_URL}/order/attachments/read`;

        try {
            const response = await axios({
                method: 'POST',
                url,
                data: {
                    order_id: parseInt(orderId)
                },
                headers: {
                    'Authorization': this._getAuthHeader(),
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            if (response.data && response.data.isError === false) {
                return {
                    success: true,
                    attachments: response.data.results || []
                };
            }

            return {
                success: false,
                error: response.data?.messages || 'Eroare la citire atașamente'
            };
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
