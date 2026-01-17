/**
 * Serviciu pentru gestionarea canalelor de vânzare (magazine)
 */

const { db, saveDatabase } = require('../config/database');

class PriceChannelsService {
    /**
     * Obține toate canalele de vânzare
     * @param {boolean} includeInactive - Include și canalele inactive
     */
    getAllChannels(includeInactive = false) {
        let sql = 'SELECT * FROM price_channels';
        if (!includeInactive) {
            sql += ' WHERE is_active = 1';
        }
        sql += ' ORDER BY display_order ASC, name ASC';

        const stmt = db.prepare(sql);
        return stmt.all();
    }

    /**
     * Obține un canal după ID
     */
    getChannelById(id) {
        const stmt = db.prepare('SELECT * FROM price_channels WHERE id = ?');
        return stmt.get(id);
    }

    /**
     * Obține un canal după nume
     */
    getChannelByName(name) {
        const stmt = db.prepare('SELECT * FROM price_channels WHERE name = ?');
        return stmt.get(name);
    }

    /**
     * Creează un canal nou
     */
    createChannel(data) {
        const { name, currency = 'RON', vat_rate = 19, show_without_vat = 0 } = data;

        // Verifică dacă există deja
        const existing = this.getChannelByName(name);
        if (existing) {
            throw new Error(`Canalul "${name}" există deja`);
        }

        // Obține următoarea poziție de afișare
        const maxOrderStmt = db.prepare('SELECT MAX(display_order) as max_order FROM price_channels');
        const result = maxOrderStmt.get();
        const displayOrder = (result?.max_order || 0) + 1;

        const stmt = db.prepare(`
            INSERT INTO price_channels (name, currency, vat_rate, show_without_vat, display_order)
            VALUES (?, ?, ?, ?, ?)
        `);

        const insertResult = stmt.run(name, currency, vat_rate, show_without_vat ? 1 : 0, displayOrder);

        return {
            id: insertResult.lastInsertRowid,
            name,
            currency,
            vat_rate,
            show_without_vat,
            display_order: displayOrder,
            is_active: 1
        };
    }

    /**
     * Actualizează un canal
     */
    updateChannel(id, data) {
        const channel = this.getChannelById(id);
        if (!channel) {
            throw new Error('Canalul nu a fost găsit');
        }

        const { name, currency, vat_rate, show_without_vat } = data;

        // Verifică dacă numele nou există deja la alt canal
        if (name && name !== channel.name) {
            const existing = this.getChannelByName(name);
            if (existing && existing.id !== id) {
                throw new Error(`Canalul "${name}" există deja`);
            }
        }

        const stmt = db.prepare(`
            UPDATE price_channels
            SET name = COALESCE(?, name),
                currency = COALESCE(?, currency),
                vat_rate = COALESCE(?, vat_rate),
                show_without_vat = COALESCE(?, show_without_vat)
            WHERE id = ?
        `);

        stmt.run(
            name || null,
            currency || null,
            vat_rate !== undefined ? vat_rate : null,
            show_without_vat !== undefined ? (show_without_vat ? 1 : 0) : null,
            id
        );

        return this.getChannelById(id);
    }

    /**
     * Dezactivează un canal (soft delete)
     */
    deleteChannel(id) {
        const channel = this.getChannelById(id);
        if (!channel) {
            throw new Error('Canalul nu a fost găsit');
        }

        const stmt = db.prepare('UPDATE price_channels SET is_active = 0 WHERE id = ?');
        stmt.run(id);

        return { success: true, message: `Canalul "${channel.name}" a fost dezactivat` };
    }

    /**
     * Reactivează un canal
     */
    activateChannel(id) {
        const stmt = db.prepare('UPDATE price_channels SET is_active = 1 WHERE id = ?');
        stmt.run(id);
        return this.getChannelById(id);
    }

    /**
     * Reordonează canalele
     * @param {number[]} orderedIds - Array cu ID-urile în noua ordine
     */
    reorderChannels(orderedIds) {
        orderedIds.forEach((id, index) => {
            const stmt = db.prepare('UPDATE price_channels SET display_order = ? WHERE id = ?');
            stmt.run(index + 1, id);
        });

        return this.getAllChannels(true);
    }

    /**
     * Inserează canalele inițiale (seed data)
     */
    seedDefaultChannels() {
        const defaults = [
            { name: 'Premierkids', currency: 'RON', vat_rate: 19, show_without_vat: 0 },
            { name: 'Magazinul de masinute', currency: 'RON', vat_rate: 19, show_without_vat: 0 },
            { name: 'eMag', currency: 'RON', vat_rate: 19, show_without_vat: 1 },
            { name: 'Altex', currency: 'RON', vat_rate: 19, show_without_vat: 0 },
            { name: 'Trendyol', currency: 'RON', vat_rate: 19, show_without_vat: 0 },
            { name: 'eMag HU', currency: 'HUF', vat_rate: 21, show_without_vat: 1 }
        ];

        let created = 0;
        for (const channel of defaults) {
            try {
                const existing = this.getChannelByName(channel.name);
                if (!existing) {
                    this.createChannel(channel);
                    created++;
                }
            } catch (e) {
                // Ignoră erorile de duplicare
            }
        }

        return { created, total: defaults.length };
    }
}

module.exports = new PriceChannelsService();
