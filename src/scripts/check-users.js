/**
 * Script pentru verificarea utilizatorilor din baza de date
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function checkUsers() {
    const SQL = await initSqlJs();
    const dbPath = path.resolve('./data/database.db');

    if (!fs.existsSync(dbPath)) {
        console.log('Baza de date nu exista!');
        return;
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const result = db.exec('SELECT id, username, is_admin, created_at FROM users');

    if (result.length === 0 || result[0].values.length === 0) {
        console.log('Nu exista utilizatori in baza de date!');
    } else {
        console.log('Utilizatori existenti:');
        result[0].values.forEach(row => {
            console.log('  ID:', row[0], '| Username:', row[1], '| Admin:', row[2], '| Created:', row[3]);
        });
    }
}

checkUsers().catch(console.error);
