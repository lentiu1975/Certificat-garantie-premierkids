/**
 * Serviciu pentru gestionarea cursurilor valutare
 * Preia cursuri de la BNR (Banca Națională a României)
 */

const { db, saveDatabase } = require('../config/database');

class ExchangeRatesService {
    constructor() {
        this.BNR_URL = 'https://www.bnr.ro/nbrfxrates.xml';
    }

    /**
     * Preia cursurile valutare de la BNR
     */
    async fetchFromBnr() {
        try {
            const response = await fetch(this.BNR_URL, {
                headers: { 'Accept': 'application/xml' },
                timeout: 10000
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            const xmlString = await response.text();
            const rates = this._parseXmlRates(xmlString);

            // Salvează în baza de date
            for (const [currency, rate] of Object.entries(rates)) {
                this._saveRate(currency, rate);
            }

            return {
                success: true,
                rates,
                fetchedAt: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Eroare preluare curs BNR: ${error.message}`);
        }
    }

    /**
     * Parsează XML-ul BNR și extrage cursurile pentru EUR și HUF
     */
    _parseXmlRates(xmlString) {
        const rates = {};

        // Extrage EUR
        const eurMatch = xmlString.match(/<Rate currency="EUR">([0-9.]+)<\/Rate>/);
        if (eurMatch) {
            rates.EUR = parseFloat(eurMatch[1]);
        }

        // Extrage HUF (vine cu multiplier="100", deci trebuie împărțit)
        const hufMatch = xmlString.match(/<Rate currency="HUF"[^>]*>([0-9.]+)<\/Rate>/);
        if (hufMatch) {
            // Verifică dacă are multiplier
            const multiplierMatch = xmlString.match(/<Rate currency="HUF" multiplier="(\d+)">/);
            const multiplier = multiplierMatch ? parseInt(multiplierMatch[1]) : 1;
            rates.HUF = parseFloat(hufMatch[1]) / multiplier;
        }

        // Extrage și USD pentru referință
        const usdMatch = xmlString.match(/<Rate currency="USD">([0-9.]+)<\/Rate>/);
        if (usdMatch) {
            rates.USD = parseFloat(usdMatch[1]);
        }

        return rates;
    }

    /**
     * Salvează un curs în baza de date
     */
    _saveRate(currency, rate) {
        const stmt = db.prepare(`
            INSERT INTO exchange_rates (currency, rate, fetched_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run(currency, rate);

        // Salvează și în app_config pentru acces rapid
        const configStmt = db.prepare(`
            INSERT INTO app_config (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `);
        configStmt.run(`exchange_rate_${currency}`, rate.toString(), rate.toString());
    }

    /**
     * Obține cursurile curente (cele mai recente)
     */
    getCurrentRates() {
        const rates = {};
        const currencies = ['EUR', 'HUF', 'USD'];

        for (const currency of currencies) {
            const stmt = db.prepare(`
                SELECT rate, fetched_at FROM exchange_rates
                WHERE currency = ?
                ORDER BY fetched_at DESC LIMIT 1
            `);
            const result = stmt.get(currency);

            if (result) {
                rates[currency] = {
                    rate: result.rate,
                    fetchedAt: result.fetched_at
                };
            }
        }

        return rates;
    }

    /**
     * Obține cursul pentru o valută specifică
     */
    getRateForCurrency(currency) {
        const stmt = db.prepare(`
            SELECT rate, fetched_at FROM exchange_rates
            WHERE currency = ?
            ORDER BY fetched_at DESC LIMIT 1
        `);
        const result = stmt.get(currency);

        if (!result) {
            return null;
        }

        return {
            currency,
            rate: result.rate,
            fetchedAt: result.fetched_at
        };
    }

    /**
     * Obține istoricul cursurilor pentru o valută
     */
    getRatesHistory(currency, days = 30) {
        const stmt = db.prepare(`
            SELECT rate, fetched_at FROM exchange_rates
            WHERE currency = ?
            AND fetched_at >= datetime('now', '-' || ? || ' days')
            ORDER BY fetched_at DESC
        `);
        return stmt.all(currency, days);
    }

    /**
     * Convertește o sumă din RON în altă valută
     */
    convertFromRon(amountRon, targetCurrency) {
        if (targetCurrency === 'RON') {
            return amountRon;
        }

        const rateInfo = this.getRateForCurrency(targetCurrency);
        if (!rateInfo) {
            throw new Error(`Nu există curs pentru ${targetCurrency}`);
        }

        return amountRon / rateInfo.rate;
    }

    /**
     * Convertește o sumă în RON din altă valută
     */
    convertToRon(amount, sourceCurrency) {
        if (sourceCurrency === 'RON') {
            return amount;
        }

        const rateInfo = this.getRateForCurrency(sourceCurrency);
        if (!rateInfo) {
            throw new Error(`Nu există curs pentru ${sourceCurrency}`);
        }

        return amount * rateInfo.rate;
    }
}

module.exports = new ExchangeRatesService();
