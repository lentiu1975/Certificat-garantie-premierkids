/**
 * Configurare și inițializare bază de date SQLite cu sql.js
 * sql.js este o implementare JavaScript pură a SQLite, funcționează fără compilare nativă
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const constants = require('./constants');

let db = null;
let SQL = null;

// Calea către fișierul bazei de date
const dbPath = path.resolve(constants.DATABASE.PATH);

/**
 * Inițializează sql.js și încarcă/creează baza de date
 */
async function initializeDatabase() {
    // Asigură că directorul data există
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Inițializează SQL.js
    SQL = await initSqlJs();

    // Încarcă baza de date existentă sau creează una nouă
    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Creează tabelele
    createTables();

    // Salvează baza de date
    saveDatabase();

    console.log('✓ Baza de date inițializată cu succes');
    return db;
}

/**
 * Creează tabelele necesare
 */
function createTables() {
    // Tabel utilizatori
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            is_admin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME
        )
    `);

    // Tabel nomenclator produse
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            smartbill_code TEXT UNIQUE NOT NULL,
            smartbill_name TEXT NOT NULL,
            warranty_pf INTEGER DEFAULT 0,
            warranty_pj INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            is_service INTEGER DEFAULT 0,
            voltage_supply TEXT,
            voltage_min TEXT,
            is_new INTEGER DEFAULT 1,
            synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Migrație: adaugă coloana is_service dacă nu există
    try {
        db.run(`ALTER TABLE products ADD COLUMN is_service INTEGER DEFAULT 0`);
    } catch (e) {
        // Coloana există deja
    }

    // Tabel configurare aplicație
    db.run(`
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabel istoric certificate generate
    db.run(`
        CREATE TABLE IF NOT EXISTS certificates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL,
            invoice_date TEXT,
            client_name TEXT,
            client_is_vat_payer INTEGER DEFAULT 0,
            products_json TEXT,
            emag_order_number TEXT,
            emag_uploaded INTEGER DEFAULT 0,
            pdf_path TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Creăm index-urile doar dacă nu există
    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_products_code ON products(smartbill_code)`);
    } catch (e) { }
    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_products_new ON products(is_new)`);
    } catch (e) { }
    try {
        db.run(`CREATE INDEX IF NOT EXISTS idx_certificates_invoice ON certificates(invoice_number)`);
    } catch (e) { }

    // Inițializare configurare implicită
    const checkConfig = db.exec("SELECT value FROM app_config WHERE key = 'last_processed_invoice'");
    if (checkConfig.length === 0) {
        db.run("INSERT OR IGNORE INTO app_config (key, value) VALUES ('last_processed_invoice', '')");
        db.run("INSERT OR IGNORE INTO app_config (key, value) VALUES ('smartbill_configured', '0')");
        db.run("INSERT OR IGNORE INTO app_config (key, value) VALUES ('emag_configured', '0')");
    }
}

/**
 * Salvează baza de date pe disc
 */
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

/**
 * Wrapper pentru compatibilitate cu better-sqlite3 API
 * Oferă metode prepare(), run(), all(), get()
 */
const dbWrapper = {
    prepare: function (sql) {
        return {
            run: function (...params) {
                try {
                    db.run(sql, params);
                    saveDatabase();
                    return { lastInsertRowid: getLastInsertRowId(), changes: db.getRowsModified() };
                } catch (error) {
                    throw error;
                }
            },
            get: function (...params) {
                const result = db.exec(sql, params);
                if (result.length === 0 || result[0].values.length === 0) return undefined;

                const columns = result[0].columns;
                const values = result[0].values[0];
                const obj = {};
                columns.forEach((col, i) => obj[col] = values[i]);
                return obj;
            },
            all: function (...params) {
                const result = db.exec(sql, params);
                if (result.length === 0) return [];

                const columns = result[0].columns;
                return result[0].values.map(row => {
                    const obj = {};
                    columns.forEach((col, i) => obj[col] = row[i]);
                    return obj;
                });
            }
        };
    },
    exec: function (sql) {
        db.run(sql);
        saveDatabase();
    },
    pragma: function () { },
    transaction: function (fn) {
        return function (...args) {
            db.run('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                db.run('COMMIT');
                saveDatabase();
                return result;
            } catch (error) {
                db.run('ROLLBACK');
                throw error;
            }
        };
    }
};

/**
 * Obține ultimul ID inserat
 */
function getLastInsertRowId() {
    const result = db.exec('SELECT last_insert_rowid() as id');
    return result[0]?.values[0]?.[0] || 0;
}

/**
 * Obține instanța bazei de date
 */
function getDb() {
    return dbWrapper;
}

module.exports = {
    initializeDatabase,
    saveDatabase,
    get db() {
        return dbWrapper;
    }
};
