/**
 * Script pentru inițializarea bazei de date și crearea primului utilizator
 */

require('dotenv').config();

const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function main() {
    console.log('');
    console.log('================================================================');
    console.log('  INIȚIALIZARE BAZĂ DE DATE - CERTIFICATE GARANȚIE PREMIERKIDS');
    console.log('================================================================');
    console.log('');

    // Inițializare bază de date (async pentru sql.js)
    console.log('Se inițializează baza de date...');
    const { initializeDatabase } = require('../config/database');
    await initializeDatabase();
    console.log('✓ Baza de date inițializată cu succes!');
    console.log('');

    // Încărcăm auth după DB init
    const { createUser, hasUsers } = require('../middleware/auth');

    // Verificăm dacă există utilizatori
    if (hasUsers()) {
        console.log('✓ Există deja utilizatori în sistem.');
        console.log('  Pentru a adăuga utilizatori noi, folosiți interfața web.');
    } else {
        console.log('Nu există utilizatori în sistem. Să creăm primul administrator.');
        console.log('');

        try {
            const username = await question('Username administrator: ');
            const password = await question('Parola (min 8 caractere): ');

            if (password.length < 8) {
                console.error('EROARE: Parola trebuie să aibă minim 8 caractere!');
                process.exit(1);
            }

            await createUser(username, password, true);
            console.log('');
            console.log('✓ Administrator creat cu succes!');
        } catch (error) {
            console.error('EROARE la crearea utilizatorului:', error.message);
            process.exit(1);
        }
    }

    console.log('');
    console.log('================================================================');
    console.log('  PAȘI URMĂTORI:');
    console.log('================================================================');
    console.log('');
    console.log('  1. Pornește aplicația: npm start');
    console.log('  2. Accesează: http://localhost:3000');
    console.log('  3. Autentifică-te cu credențialele create');
    console.log('  4. Configurează SmartBill API din Setări');
    console.log('  5. Sincronizează nomenclatorul de produse');
    console.log('  6. Începe generarea certificatelor!');
    console.log('');
    console.log('================================================================');
    console.log('');

    rl.close();
    process.exit(0);
}

main().catch(console.error);
