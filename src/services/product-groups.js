/**
 * Serviciu pentru gestionarea grupurilor de produse (nomenclator secundar pentru prețuri)
 * Grupează produsele automat după denumire pentru a facilita managementul prețurilor
 */

const { db, saveDatabase } = require('../config/database');

class ProductGroupsService {
    constructor() {
        // Cuvinte care indică variante (culori, dimensiuni) - se oprește gruparea la aceste cuvinte
        // DOAR culori - fără dimensiuni sau alte variante care pot fi parte din denumirea produsului
        this.variantWords = [
            // Culori în română (cu și fără diacritice)
            'rosu', 'albastru', 'verde', 'negru', 'alb', 'roz', 'galben',
            'portocaliu', 'mov', 'gri', 'maro', 'bej', 'turcoaz', 'argintiu',
            'auriu', 'crem', 'bordo', 'visiniu', 'lila', 'caramiziu',
            'camuflaj', 'army', 'militar', 'kaki', 'khaki',
            // Culori în engleză
            'red', 'blue', 'green', 'black', 'white', 'pink', 'yellow',
            'orange', 'purple', 'grey', 'gray', 'brown', 'silver', 'gold',
            'beige', 'turquoise', 'burgundy', 'cream'
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
     * ATENȚIE: Șterge TOATE grupurile existente și le recreează!
     */
    generateGroupsFromProducts() {
        // Șterge toate grupurile existente
        console.log('[ProductGroups] Ștergem toate grupurile existente...');
        db.prepare('DELETE FROM product_groups').run();
        db.prepare('DELETE FROM group_prices').run();

        // Obține toate produsele active din nomenclator
        const productsStmt = db.prepare(`
            SELECT smartbill_code, smartbill_name
            FROM products
            WHERE is_active = 1 AND (is_service = 0 OR is_service IS NULL)
            ORDER BY smartbill_name
        `);
        const products = productsStmt.all();

        console.log(`[ProductGroups] Found ${products.length} active products for grouping`);

        // DEBUG: Afișăm primele 10 produse pentru a vedea denumirile
        console.log('[ProductGroups] Primele 10 produse:');
        products.slice(0, 10).forEach((p, i) => {
            const extracted = this._extractGroupName(p.smartbill_name);
            console.log(`  ${i+1}. "${p.smartbill_name}" => "${extracted}"`);
        });

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

        for (const [name, data] of groupsMap) {
            this.createGroup({
                group_name: name,
                smartbill_codes: data.codes,
                base_price: 0
            });
            created++;
        }

        return {
            total: groupsMap.size,
            created,
            message: `${created} grupuri create din ${groupsMap.size} identificate`
        };
    }

    /**
     * Extrage numele grupului din denumirea produsului
     * Elimină doar ultimele cuvinte care indică variante (culori, dimensiuni)
     * Exemplu: "ATV electric 4x4 Premier Desert, 12V, roti cauciuc EVA, MP3, albastru"
     *       -> "ATV electric 4x4 Premier Desert, 12V, roti cauciuc EVA, MP3,"
     */
    _extractGroupName(productName) {
        // Curăță virgula finală și spațiile
        let name = productName.trim().replace(/,\s*$/, '');
        const words = name.split(/\s+/);

        // Parcurgem de la final și eliminăm cuvintele de variantă
        let endIndex = words.length;

        for (let i = words.length - 1; i >= 0; i--) {
            const wordClean = words[i].toLowerCase()
                .replace(/[()[\]{}.,;:!?'"]/g, ''); // Curăță punctuație

            if (this._isVariantWord(wordClean)) {
                endIndex = i; // Tăiem de aici
            } else {
                // Nu mai e variantă, ne oprim
                break;
            }
        }

        // Luăm cuvintele până la endIndex
        const groupNameWords = words.slice(0, endIndex);

        // Minim 2 cuvinte pentru un grup valid
        if (groupNameWords.length < 2) {
            // Folosește primele cuvinte (fără ultimul dacă e culoare)
            return words.slice(0, Math.max(2, words.length - 1)).join(' ').trim();
        }

        // Curăță virgula finală dacă există
        return groupNameWords.join(' ').trim().replace(/,\s*$/, '');
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

        const totalProductsStmt = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND (is_service = 0 OR is_service IS NULL)');
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
