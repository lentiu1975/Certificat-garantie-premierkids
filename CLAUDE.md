# Instrucțiuni pentru Claude

## REGULA PRINCIPALĂ - FOARTE IMPORTANTĂ

**CLAUDE FACE TOTUL. UTILIZATORUL NU FACE NIMIC. NICIODATĂ.**

- Claude scrie codul
- Claude face git add, commit, push
- Claude face deploy pe server
- Claude dă restart dacă e nevoie
- Utilizatorul doar cere ce vrea și verifică rezultatul final în browser

## Reguli obligatorii

1. **VERIFICĂ ÎNTOTDEAUNA înainte de a spune că e gata**: După orice modificare, nu declara că e gata până nu:
   - Verifici că codul nou există în fișierele modificate
   - Testezi endpoint-urile noi (dacă e posibil)
   - Te asiguri că toate dependențele sunt corecte

2. **NU cere utilizatorului să facă nimic manual**:
   - NU cere să acceseze URL-uri speciale
   - NU cere să dea restart manual
   - NU cere să facă upload/deploy
   - NU cere să facă git push
   - Tot ce trebuie să funcționeze trebuie să meargă AUTOMAT

3. **Testare locală**: Dacă faci modificări la backend:
   - Citește codul înapoi după modificare pentru a verifica
   - Asigură-te că funcțiile/metodele apelate există în serviciile importate

## Proiect: Garantie Premierkids

- Node.js + Express + EJS
- SQLite cu sql.js (nu better-sqlite3)
- SmartBill API - DOAR CITIRE
- eMAG API pentru upload certificate
- Git repo: https://github.com/lentiu1975/Certificat-garantie-premierkids.git
- Server: Se face deploy automat după git push (sau manual din cPanel)

## Module active

- Certificate Garanție (funcțional)
- Prețuri (în dezvoltare)
