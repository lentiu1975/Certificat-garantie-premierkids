/**
 * Serviciu pentru gestionarea prețurilor
 * Gestionează prețurile per grup per canal, conversii valutare și import/export
 */

const { db, saveDatabase } = require('../config/database');
const exchangeRatesService = require('./exchange-rates');
const priceChannelsService = require('./price-channels');
const productGroupsService = require('./product-groups');

class PricesService {
    /**
     * Obține prețurile pentru un grup
     */
    getPricesByGroup(groupId) {
        const stmt = db.prepare(`
            SELECT gp.*, pc.name as channel_name, pc.currency, pc.vat_rate, pc.show_without_vat
            FROM group_prices gp
            JOIN price_channels pc ON gp.channel_id = pc.id
            WHERE gp.group_id = ?
            ORDER BY pc.display_order
        `);

        return stmt.all(groupId);
    }

    /**
     * Obține prețurile pentru un canal
     */
    getPricesByChannel(channelId) {
        const stmt = db.prepare(`
            SELECT gp.*, pg.group_name, pg.base_price
            FROM group_prices gp
            JOIN product_groups pg ON gp.group_id = pg.id
            WHERE gp.channel_id = ? AND pg.is_active = 1
            ORDER BY pg.group_name
        `);

        return stmt.all(channelId);
    }

    /**
     * Setează un preț pentru un grup pe un canal
     */
    setPrice(groupId, channelId, price, expiresAt = null) {
        const channel = priceChannelsService.getChannelById(channelId);
        if (!channel) {
            throw new Error('Canalul nu a fost găsit');
        }

        // Calculează prețul fără TVA
        const priceWithoutVat = price / (1 + channel.vat_rate / 100);

        const stmt = db.prepare(`
            INSERT INTO group_prices (group_id, channel_id, price, price_without_vat, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(group_id, channel_id) DO UPDATE SET
                price = ?,
                price_without_vat = ?,
                expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
        `);

        stmt.run(
            groupId, channelId, price, priceWithoutVat, expiresAt,
            price, priceWithoutVat, expiresAt
        );

        return {
            group_id: groupId,
            channel_id: channelId,
            price,
            price_without_vat: priceWithoutVat,
            expires_at: expiresAt
        };
    }

    /**
     * Setează prețuri în masă pentru un grup
     */
    setBulkPrices(groupId, prices) {
        const results = [];

        for (const priceData of prices) {
            const { channel_id, price, expires_at } = priceData;

            if (price !== null && price !== undefined && price !== '') {
                const result = this.setPrice(groupId, channel_id, parseFloat(price), expires_at || null);
                results.push(result);
            }
        }

        return results;
    }

    /**
     * Obține toate grupurile cu prețurile lor
     */
    getAllGroupsWithPrices() {
        const groups = productGroupsService.getAllGroups();
        const channels = priceChannelsService.getAllChannels();

        return groups.map(group => {
            const prices = this.getPricesByGroup(group.id);
            const pricesMap = {};

            // Creează un map cu prețurile per canal
            for (const price of prices) {
                pricesMap[price.channel_id] = {
                    price: price.price,
                    price_without_vat: price.price_without_vat,
                    expires_at: price.expires_at,
                    is_expired: price.expires_at && new Date(price.expires_at) < new Date()
                };
            }

            return {
                ...group,
                prices: pricesMap,
                products_count: group.smartbill_codes.length
            };
        });
    }

    /**
     * Calculează prețul sugerat într-o valută bazat pe prețul de bază RON
     */
    calculateSuggestedPrice(basePriceRon, targetCurrency) {
        if (targetCurrency === 'RON') {
            return basePriceRon;
        }

        try {
            const converted = exchangeRatesService.convertFromRon(basePriceRon, targetCurrency);
            return converted;
        } catch (error) {
            return null;
        }
    }

    /**
     * Obține prețurile expirate
     */
    getExpiredPrices() {
        const stmt = db.prepare(`
            SELECT gp.*, pg.group_name, pc.name as channel_name
            FROM group_prices gp
            JOIN product_groups pg ON gp.group_id = pg.id
            JOIN price_channels pc ON gp.channel_id = pc.id
            WHERE gp.expires_at IS NOT NULL
            AND gp.expires_at < date('now')
            AND pg.is_active = 1
            ORDER BY gp.expires_at ASC
        `);

        return stmt.all();
    }

    /**
     * Obține prețurile care expiră în curând
     */
    getExpiringSoonPrices(days = 7) {
        const stmt = db.prepare(`
            SELECT gp.*, pg.group_name, pc.name as channel_name
            FROM group_prices gp
            JOIN product_groups pg ON gp.group_id = pg.id
            JOIN price_channels pc ON gp.channel_id = pc.id
            WHERE gp.expires_at IS NOT NULL
            AND gp.expires_at >= date('now')
            AND gp.expires_at <= date('now', '+' || ? || ' days')
            AND pg.is_active = 1
            ORDER BY gp.expires_at ASC
        `);

        return stmt.all(days);
    }

    /**
     * Export prețuri în format CSV
     */
    exportToCsv() {
        const groups = this.getAllGroupsWithPrices();
        const channels = priceChannelsService.getAllChannels();

        // Header
        const headers = ['group_name', 'base_price', 'products_count'];
        for (const channel of channels) {
            headers.push(`${channel.name}_${channel.currency}`);
            if (channel.show_without_vat) {
                headers.push(`${channel.name}_fara_TVA`);
            }
        }

        // Rows
        const rows = groups.map(group => {
            const row = [
                `"${group.group_name}"`,
                group.base_price || 0,
                group.products_count
            ];

            for (const channel of channels) {
                const priceData = group.prices[channel.id];
                row.push(priceData?.price || '');
                if (channel.show_without_vat) {
                    row.push(priceData?.price_without_vat?.toFixed(4) || '');
                }
            }

            return row.join(',');
        });

        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Import prețuri din CSV
     */
    importFromCsv(csvData) {
        const lines = csvData.trim().split('\n');
        if (lines.length < 2) {
            throw new Error('Fișierul CSV trebuie să conțină header și cel puțin o linie de date');
        }

        const header = this._parseCsvLine(lines[0]);
        const channels = priceChannelsService.getAllChannels();

        // Identifică coloanele
        const groupNameIndex = header.findIndex(h => h.toLowerCase().includes('group_name') || h.toLowerCase().includes('produs'));
        const basePriceIndex = header.findIndex(h => h.toLowerCase().includes('base_price') || h.toLowerCase().includes('pret_baza'));

        if (groupNameIndex === -1) {
            throw new Error('Coloana "group_name" sau "produs" nu a fost găsită în CSV');
        }

        // Mapează coloanele de prețuri la canale
        const channelColumns = [];
        for (let i = 0; i < header.length; i++) {
            if (i === groupNameIndex || i === basePriceIndex) continue;
            if (header[i].toLowerCase().includes('fara_tva') || header[i].toLowerCase().includes('products_count')) continue;

            // Caută canalul corespunzător
            for (const channel of channels) {
                if (header[i].toLowerCase().includes(channel.name.toLowerCase())) {
                    channelColumns.push({ index: i, channel });
                    break;
                }
            }
        }

        const results = { updated: 0, errors: [], skipped: 0 };

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            try {
                const values = this._parseCsvLine(lines[i]);
                const groupName = values[groupNameIndex]?.replace(/"/g, '').trim();

                if (!groupName) {
                    results.skipped++;
                    continue;
                }

                // Găsește grupul
                const group = productGroupsService.getGroupByName(groupName);
                if (!group) {
                    results.errors.push({ line: i + 1, error: `Grupul "${groupName}" nu a fost găsit` });
                    continue;
                }

                // Actualizează prețul de bază
                if (basePriceIndex !== -1) {
                    const basePrice = parseFloat(values[basePriceIndex]);
                    if (!isNaN(basePrice) && basePrice > 0) {
                        productGroupsService.updateGroup(group.id, { base_price: basePrice });
                    }
                }

                // Actualizează prețurile per canal
                for (const { index, channel } of channelColumns) {
                    const price = parseFloat(values[index]);
                    if (!isNaN(price) && price > 0) {
                        this.setPrice(group.id, channel.id, price, null);
                        results.updated++;
                    }
                }
            } catch (error) {
                results.errors.push({ line: i + 1, error: error.message });
            }
        }

        return results;
    }

    /**
     * Parsează o linie CSV (gestionează și virgulele din ghilimele)
     */
    _parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());

        return result;
    }

    /**
     * Obține statistici despre prețuri
     */
    getStats() {
        const totalGroupsStmt = db.prepare('SELECT COUNT(*) as count FROM product_groups WHERE is_active = 1');
        const totalGroups = totalGroupsStmt.get().count;

        const withBasePriceStmt = db.prepare('SELECT COUNT(*) as count FROM product_groups WHERE is_active = 1 AND base_price > 0');
        const withBasePrice = withBasePriceStmt.get().count;

        const expiredStmt = db.prepare(`
            SELECT COUNT(DISTINCT group_id) as count FROM group_prices
            WHERE expires_at IS NOT NULL AND expires_at < date('now')
        `);
        const expired = expiredStmt.get().count;

        const expiringSoonStmt = db.prepare(`
            SELECT COUNT(DISTINCT group_id) as count FROM group_prices
            WHERE expires_at IS NOT NULL
            AND expires_at >= date('now')
            AND expires_at <= date('now', '+7 days')
        `);
        const expiringSoon = expiringSoonStmt.get().count;

        return {
            totalGroups,
            withBasePrice,
            withoutBasePrice: totalGroups - withBasePrice,
            expired,
            expiringSoon
        };
    }
}

module.exports = new PricesService();
