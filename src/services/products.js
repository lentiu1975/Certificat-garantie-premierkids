/**
 * Serviciu pentru gestionarea nomenclatorului de produse
 */

const { db } = require('../config/database');
const smartBillService = require('./smartbill');

class ProductsService {
    /**
     * Sincronizează produsele din SmartBill cu baza de date locală
     * Produsele noi vor fi marcate ca is_new = 1
     */
    async syncProducts() {
        const smartBillResponse = await smartBillService.getProducts();

        // SmartBill /stocks returnează: { list: [{ warehouse: {...}, products: [...] }, ...] }
        // Fiecare element din list este un depozit cu produsele sale
        if (!smartBillResponse || !smartBillResponse.list || !Array.isArray(smartBillResponse.list)) {
            console.error('Format răspuns SmartBill neașteptat:', JSON.stringify(smartBillResponse).substring(0, 500));
            throw new Error('Format răspuns SmartBill neașteptat');
        }

        // Extragem toate produsele din toate depozitele
        // Folosim un Map pentru a evita duplicatele (același produs poate fi în mai multe depozite)
        const productsMap = new Map();

        for (const warehouse of smartBillResponse.list) {
            if (warehouse.products && Array.isArray(warehouse.products)) {
                for (const product of warehouse.products) {
                    // Adăugăm produsul doar dacă nu există deja (evităm duplicatele)
                    if (product.productCode && !productsMap.has(product.productCode)) {
                        productsMap.set(product.productCode, {
                            code: product.productCode,
                            name: product.productName
                        });
                    }
                }
            }
        }

        const products = Array.from(productsMap.values());

        if (products.length === 0) {
            throw new Error('Nu s-au găsit produse în SmartBill');
        }

        console.log(`Găsite ${products.length} produse unice din ${smartBillResponse.list.length} depozite`);
        let newCount = 0;

        const insertStmt = db.prepare(`
            INSERT INTO products (smartbill_code, smartbill_name, is_new, synced_at)
            VALUES (?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(smartbill_code) DO UPDATE SET
                smartbill_name = excluded.smartbill_name,
                synced_at = CURRENT_TIMESTAMP
        `);

        const checkStmt = db.prepare('SELECT id FROM products WHERE smartbill_code = ?');

        // Procesăm fiecare produs individual (fără tranzacție explicită pentru compatibilitate sql.js)
        for (const product of products) {
            const existing = checkStmt.get(product.code);

            if (!existing) {
                newCount++;
            }

            insertStmt.run(product.code, product.name);
        }

        return {
            total: products.length,
            newProducts: newCount,
            message: `Sincronizare completă: ${products.length} produse, ${newCount} noi`
        };
    }

    /**
     * Obține toate produsele din nomenclator
     */
    getAllProducts(includeInactive = true) {
        let query = 'SELECT * FROM products';
        if (!includeInactive) {
            query += ' WHERE is_active = 1';
        }
        query += ' ORDER BY is_new DESC, smartbill_name ASC';

        const stmt = db.prepare(query);
        return stmt.all();
    }

    /**
     * Obține doar produsele noi (neconfigurate)
     */
    getNewProducts() {
        const stmt = db.prepare(`
            SELECT * FROM products
            WHERE is_new = 1
            ORDER BY smartbill_name ASC
        `);
        return stmt.all();
    }

    /**
     * Obține produsele active
     */
    getActiveProducts() {
        const stmt = db.prepare(`
            SELECT * FROM products
            WHERE is_active = 1
            ORDER BY smartbill_name ASC
        `);
        return stmt.all();
    }

    /**
     * Actualizează un produs
     */
    updateProduct(id, data) {
        const { warranty_pf, warranty_pj, is_active, is_service, voltage_supply, voltage_min } = data;

        // Verificăm dacă toate câmpurile obligatorii sunt completate
        const allFieldsComplete =
            warranty_pf !== null && warranty_pf !== undefined && warranty_pf !== '' &&
            warranty_pj !== null && warranty_pj !== undefined && warranty_pj !== '' &&
            voltage_supply !== null && voltage_supply !== undefined && voltage_supply !== '' &&
            voltage_min !== null && voltage_min !== undefined && voltage_min !== '';

        // Produsul este configurat dacă:
        // - toate câmpurile sunt completate, SAU
        // - produsul este inactiv (nu necesită configurare), SAU
        // - produsul este marcat ca serviciu (nu necesită garanție)
        const isNew = (allFieldsComplete || !is_active || is_service) ? 0 : 1;

        const stmt = db.prepare(`
            UPDATE products SET
                warranty_pf = ?,
                warranty_pj = ?,
                is_active = ?,
                is_service = ?,
                voltage_supply = ?,
                voltage_min = ?,
                is_new = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        stmt.run(
            warranty_pf || 0,
            warranty_pj || 0,
            is_active ? 1 : 0,
            is_service ? 1 : 0,
            voltage_supply || '',
            voltage_min || '',
            isNew,
            id
        );

        return { success: true };
    }

    /**
     * Actualizare în masă a produselor
     */
    bulkUpdateProducts(products) {
        const results = [];

        // Procesăm fiecare produs individual (fără tranzacție pentru compatibilitate sql.js)
        for (const product of products) {
            try {
                this.updateProduct(product.id, product);
                results.push({ id: product.id, success: true });
            } catch (error) {
                results.push({ id: product.id, success: false, error: error.message });
            }
        }

        return results;
    }

    /**
     * Obține un produs după codul SmartBill
     */
    getProductByCode(code) {
        const stmt = db.prepare('SELECT * FROM products WHERE smartbill_code = ?');
        return stmt.get(code);
    }

    /**
     * Obține un produs după ID
     */
    getProductById(id) {
        const stmt = db.prepare('SELECT * FROM products WHERE id = ?');
        return stmt.get(id);
    }

    /**
     * Verifică dacă un produs este activ
     */
    isProductActive(code) {
        const product = this.getProductByCode(code);
        return product && product.is_active === 1;
    }

    /**
     * Obține termenul de garanție pentru un produs
     * @param {string} code - Codul produsului
     * @param {boolean} isVatPayer - Dacă clientul este plătitor de TVA (PJ)
     */
    getWarrantyTerm(code, isVatPayer) {
        const product = this.getProductByCode(code);
        if (!product) return 0;

        return isVatPayer ? product.warranty_pj : product.warranty_pf;
    }

    /**
     * Obține tensiunea minimă pentru un produs
     */
    getMinVoltage(code) {
        const product = this.getProductByCode(code);
        return product ? product.voltage_min : '';
    }

    /**
     * Numără produsele noi (doar cele active, non-servicii, care necesită configurare)
     */
    countNewProducts() {
        const stmt = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_new = 1 AND is_active = 1 AND (is_service = 0 OR is_service IS NULL)');
        const result = stmt.get();
        return result.count;
    }

    /**
     * Auto-completează produsele bazat pe reguli:
     * - Dacă denumirea conține "premier": activ, garanție PF=24, PJ=12, extrage tensiunea
     * - Dacă denumirea NU conține "premier": inactiv
     */
    autoFillProducts() {
        const products = this.getAllProducts(true);
        let premierCount = 0;
        let inactiveCount = 0;
        let updatedCount = 0;

        for (const product of products) {
            const name = (product.smartbill_name || '').toLowerCase();
            const isPremier = name.includes('premier');

            if (isPremier) {
                // Produs Premier - activ, cu garanție
                premierCount++;

                // Detectăm tensiunea din denumire
                let voltageSupply = '';
                let voltageMin = '';

                if (name.includes('24v')) {
                    voltageSupply = '24V';
                    voltageMin = '20';
                } else if (name.includes('12v')) {
                    voltageSupply = '12V';
                    voltageMin = '10.8';
                } else if (name.includes('6v')) {
                    voltageSupply = '6V';
                    voltageMin = '4.5';
                }

                // Actualizăm produsul
                this.updateProduct(product.id, {
                    warranty_pf: 24,
                    warranty_pj: 12,
                    voltage_supply: voltageSupply,
                    voltage_min: voltageMin,
                    is_active: true,
                    is_service: false
                });
                updatedCount++;
            } else {
                // Produs non-Premier - inactiv
                inactiveCount++;
                this.updateProduct(product.id, {
                    warranty_pf: product.warranty_pf || 0,
                    warranty_pj: product.warranty_pj || 0,
                    voltage_supply: product.voltage_supply || '',
                    voltage_min: product.voltage_min || '',
                    is_active: false,
                    is_service: product.is_service === 1
                });
                updatedCount++;
            }
        }

        return {
            total: products.length,
            premierProducts: premierCount,
            inactiveProducts: inactiveCount,
            updatedCount,
            message: `Auto-completare finalizată: ${premierCount} produse Premier (active), ${inactiveCount} produse non-Premier (inactive)`
        };
    }
}

// Singleton instance
const productsService = new ProductsService();

module.exports = productsService;
