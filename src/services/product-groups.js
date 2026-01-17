/**
 * Serviciu pentru gestionarea grupurilor de produse (nomenclator secundar pentru prețuri)
 * Grupează produsele automat după denumire pentru a facilita managementul prețurilor
 */

const { db, saveDatabase } = require('../config/database');

class ProductGroupsService {
    constructor() {
        // Cuvinte care indică variante (culori, dimensiuni) - se oprește gruparea la aceste cuvinte
        this.variantWords = [
            // Culori în română
            'rosu', 'albastru', 'verde', 'negru', 'alb', 'roz', 'galben',
            'portocaliu', 'mov', 'gri', 'maro', 'bej', 'turcoaz', 'argintiu',
            'auriu', 'crem', 'bordo', 'visiniu', 'lila', 'caramiziu',
            // Culori în engleză
            'red', 'blue', 'green', 'black', 'white', 'pink', 'yellow',
            'orange', 'purple', 'grey', 'gray', 'brown', 'silver', 'gold',
            'beige', 'turquoise', 'burgundy', 'cream',
            // Variante dimensiune
            '2x', '4x', '6x', 'mare', 'mic', 'mediu', 'xl', 'xxl', 'xs',
            // Alte variante comune
            'nou', 'new', 'editie', 'edition', 'limited', 'special'
        ];
    }

    /**
     * Obține toate grupurile de produse
     */
    getAllGroups(includeInactive = false) {
        let sql = 'SELECT * FROM product_groups';
        if (!includeInactive) {
            sql += ' WHERE is_active = 1';
        }
        sql += ' ORDER BY group_name ASC';

        const stmt = db.prepare(sql);
        const groups = stmt.all();

        // Parsează JSON pentru smartbill_codes
        return groups.map(g => ({
            ...g,
            smartbill_codes: g.smartbill_codes ? JSON.parse(g.smartbill_codes) : []
        }));
    }

    /**
     * Obține un grup după ID
     */
    getGroupById(id) {
        const stmt = db.prepare('SELECT * FROM product_groups WHERE id = ?');
        const group = stmt.get(id);

        if (!group) return null;

        return {
            ...group,
            smartbill_codes: group.smartbill_codes ? JSON.parse(group.smartbill_codes) : []
        };
    }

    /**
     * Obține un grup după nume
     */
    getGroupByName(name) {
        const stmt = db.prepare('SELECT * FROM product_groups WHERE group_name = ?');
        const group = stmt.get(name);

        if (!group) return null;

        return {
            ...group,
            smartbill_codes: group.smartbill_codes ? JSON.parse(group.smartbill_codes) : []
        };
    }

    /**
     * Creează un grup nou
     */
    createGroup(data) {
        const { group_name, base_price = 0, smartbill_codes = [] } = data;

        const stmt = db.prepare(`
            INSERT INTO product_groups (group_name, base_price, smartbill_codes)
            VALUES (?, ?, ?)
        `);

        const result = stmt.run(
            group_name,
            base_price,
            JSON.stringify(smartbill_codes)
        );

        return {
            id: result.lastInsertRowid,
            group_name,
            base_price,
            smartbill_codes,
            is_active: 1
        };
    }

    /**
     * Actualizează un grup
     */
    updateGroup(id, data) {
        const group = this.getGroupById(id);
        if (!group) {
            throw new Error('Grupul nu a fost găsit');
        }

        const { group_name, base_price, smartbill_codes } = data;

        const stmt = db.prepare(`
            UPDATE product_groups
            SET group_name = COALESCE(?, group_name),
                base_price = COALESCE(?, base_price),
                smartbill_codes = COALESCE(?, smartbill_codes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        stmt.run(
            group_name || null,
            base_price !== undefined ? base_price : null,
            smartbill_codes ? JSON.stringify(smartbill_codes) : null,
            id
        );

        return this.getGroupById(id);
    }

    /**
     * Șterge un grup (soft delete)
     */
    deleteGroup(id) {
        const group = this.getGroupById(id);
        if (!group) {
            throw new Error('Grupul nu a fost găsit');
        }

        const stmt = db.prepare('UPDATE product_groups SET is_active = 0 WHERE id = ?');
        stmt.run(id);

        return { success: true, message: `Grupul "${group.group_name}" a fost șters` };
    }

    /**
     * Generează automat grupuri din produsele active
     * Algoritm: grupează produsele după denumire până la cuvântul de variație (culoare, etc.)
     */
    generateGroupsFromProducts() {
        // Obține toate produsele active din nomenclator
        const productsStmt = db.prepare(`
            SELECT smartbill_code, smartbill_name
            FROM products
            WHERE is_active = 1 AND is_service = 0
            ORDER BY smartbill_name
        `);
        const products = productsStmt.all();

        if (products.length === 0) {
            return { total: 0, created: 0, message: 'Nu există produse active în nomenclator' };
        }

        // Grupează produsele
        const groupsMap = new Map();

        for (const product of products) {
            const groupName = this._extractGroupName(product.smartbill_name);

            if (!groupsMap.has(groupName)) {
                groupsMap.set(groupName, {
                    name: groupName,
                    codes: []
                });
            }

            groupsMap.get(groupName).codes.push(product.smartbill_code);
        }

        // Salvează grupurile în baza de date
        let created = 0;
        let updated = 0;

        for (const [name, data] of groupsMap) {
            // Verifică dacă grupul există deja
            const existing = this.getGroupByName(name);

            if (existing) {
                // Actualizează codurile (adaugă noi, păstrează prețul)
                const allCodes = [...new Set([...existing.smartbill_codes, ...data.codes])];
                this.updateGroup(existing.id, { smartbill_codes: allCodes });
                updated++;
            } else {
                // Creează grup nou
                this.createGroup({
                    group_name: name,
                    smartbill_codes: data.codes,
                    base_price: 0
                });
                created++;
            }
        }

        return {
            total: groupsMap.size,
            created,
            updated,
            message: `${created} grupuri noi create, ${updated} actualizate din ${groupsMap.size} identificate`
        };
    }

    /**
     * Extrage numele grupului din denumirea produsului
     * Elimină cuvintele care indică variante (culori, dimensiuni)
     */
    _extractGroupName(productName) {
        const words = productName.split(/\s+/);
        const groupNameWords = [];

        for (const word of words) {
            const wordClean = word.toLowerCase()
                .replace(/[()[\]{}.,;:!?'"]/g, '') // Curăță punctuație
                .replace(/^\d+$/, ''); // Elimină numere izolate

            // Verifică dacă cuvântul este o variantă
            const isVariant = this._isVariantWord(wordClean);

            if (isVariant) {
                break; // Oprește la primul cuvânt de variantă
            }

            groupNameWords.push(word);
        }

        // Minim 2 cuvinte pentru un grup valid
        if (groupNameWords.length < 2) {
            // Folosește primele 3-4 cuvinte
            return words.slice(0, Math.min(4, words.length)).join(' ').trim();
        }

        return groupNameWords.join(' ').trim();
    }

    /**
     * Verifică dacă un cuvânt este un indicator de variantă
     */
    _isVariantWord(word) {
        if (!word || word.length < 2) return false;

        const wordLower = word.toLowerCase();

        return this.variantWords.some(variant => {
            // Potrivire exactă
            if (wordLower === variant) return true;
            // Începe cu varianta (ex: "rosie" pentru "rosu")
            if (wordLower.startsWith(variant) && wordLower.length <= variant.length + 3) return true;
            // Se termină cu varianta
            if (wordLower.endsWith(variant) && wordLower.length <= variant.length + 3) return true;
            return false;
        });
    }

    /**
     * Obține produsele asociate unui grup
     */
    getProductsForGroup(groupId) {
        const group = this.getGroupById(groupId);
        if (!group || !group.smartbill_codes.length) {
            return [];
        }

        const placeholders = group.smartbill_codes.map(() => '?').join(',');
        const stmt = db.prepare(`
            SELECT * FROM products
            WHERE smartbill_code IN (${placeholders})
            ORDER BY smartbill_name
        `);

        return stmt.all(...group.smartbill_codes);
    }

    /**
     * Obține statistici despre grupuri
     */
    getStats() {
        const totalGroupsStmt = db.prepare('SELECT COUNT(*) as count FROM product_groups WHERE is_active = 1');
        const totalGroups = totalGroupsStmt.get().count;

        const withPriceStmt = db.prepare('SELECT COUNT(*) as count FROM product_groups WHERE is_active = 1 AND base_price > 0');
        const withPrice = withPriceStmt.get().count;

        const totalProductsStmt = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND is_service = 0');
        const totalProducts = totalProductsStmt.get().count;

        return {
            totalGroups,
            withPrice,
            withoutPrice: totalGroups - withPrice,
            totalProducts
        };
    }
}

module.exports = new ProductGroupsService();
