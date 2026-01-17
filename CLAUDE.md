# Instrucțiuni pentru Claude

## Reguli obligatorii

1. **VERIFICĂ ÎNTOTDEAUNA înainte de a spune că e gata**: După orice modificare, nu declara că e gata până nu:
   - Verifici că codul nou există în fișierele modificate
   - Testezi endpoint-urile noi (dacă e posibil)
   - Te asiguri că toate dependențele sunt corecte

2. **Utilizatorul face TOTUL**: Upload, deploy, restart - utilizatorul se ocupă de toate. Tu doar:
   - Scrii codul corect
   - Actualizezi tmp/restart.txt când e nevoie de restart
   - NU ceri utilizatorului să acceseze URL-uri speciale sau să facă pași manuali suplimentari
   - Tot ce trebuie să funcționeze trebuie să meargă AUTOMAT la pornirea serverului

3. **Testare locală**: Dacă faci modificări la backend:
   - Citește codul înapoi după modificare pentru a verifica
   - Asigură-te că funcțiile/metodele apelate există în serviciile importate

## Proiect: Garantie Premierkids

- Node.js + Express + EJS
- SQLite cu sql.js (nu better-sqlite3)
- SmartBill API - DOAR CITIRE
- eMAG API pentru upload certificate

## Module active

- Certificate Garanție (funcțional)
- Prețuri (în dezvoltare)
