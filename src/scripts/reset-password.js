/**
 * Script pentru resetarea parolei unui utilizator
 * Utilizare: node src/scripts/reset-password.js <username> <noua_parola>
 */

require('dotenv').config();
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

async function resetPassword() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('Utilizare: node src/scripts/reset-password.js <username> <noua_parola>');
        console.log('Exemplu: node src/scripts/reset-password.js admin parola123');
        process.exit(1);
    }

    const username = args[0];
    const newPassword = args[1];

    if (newPassword.length < 8) {
        console.error('Eroare: Parola trebuie sa aiba minim 8 caractere!');
        process.exit(1);
    }

    const SQL = await initSqlJs();
    const dbPath = path.resolve('./data/database.db');

    if (!fs.existsSync(dbPath)) {
        console.error('Eroare: Baza de date nu exista!');
        process.exit(1);
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Verificam daca utilizatorul exista
    const userCheck = db.exec(`SELECT id, username FROM users WHERE username = '${username}'`);

    if (userCheck.length === 0 || userCheck[0].values.length === 0) {
        console.error(`Eroare: Utilizatorul '${username}' nu exista!`);
        process.exit(1);
    }

    // Hash noua parola
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Actualizam parola
    db.run(`UPDATE users SET password_hash = '${passwordHash}' WHERE username = '${username}'`);

    // Salvam baza de date
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);

    console.log('');
    console.log('================================================================');
    console.log(`  Parola pentru utilizatorul '${username}' a fost resetata!`);
    console.log('================================================================');
    console.log(`  Noua parola: ${newPassword}`);
    console.log('');
    console.log('  Puteti acum sa va autentificati la: http://localhost:3000/auth/login');
    console.log('================================================================');
    console.log('');
}

resetPassword().catch(console.error);
