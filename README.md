# Certificate Garanție PremierKids

Aplicație web pentru generarea automată a certificatelor de garanție din facturi SmartBill.

## Caracteristici

- **Autentificare securizată** - Sistem de login cu user/parolă
- **Credențiale criptate** - API keys stocate criptat cu AES-256-GCM
- **SmartBill Integration (READ-ONLY)** - Citire facturi și nomenclator produse
- **eMAG Marketplace** - Upload automat certificate pentru comenzi eMAG
- **Nomenclator produse** - Gestionare garanții diferențiate PF/PJ
- **Generare PDF** - Certificate generate din template personalizabil

## ⚠️ IMPORTANT - SmartBill API

**Această aplicație funcționează EXCLUSIV în mod READ-ONLY!**

Nu se trimit NICIODATĂ date către SmartBill. Aplicația doar citește:
- Lista de produse (nomenclator)
- Lista de facturi
- Detalii facturi

## Instalare

### Cerințe
- Node.js >= 18.0.0
- npm sau yarn

### Pași instalare

1. **Clonează/copiază proiectul**

2. **Instalează dependențele:**
```bash
npm install
```

3. **Configurează variabilele de mediu:**
```bash
# Copiază fișierul example
cp .env.example .env

# Editează .env și completează:
# - SESSION_SECRET (minim 32 caractere)
# - ENCRYPTION_KEY (minim 32 caractere)
```

4. **Inițializează baza de date:**
```bash
npm run init-db
```

5. **Pornește aplicația:**
```bash
npm start
```

6. **Accesează aplicația:**
```
http://localhost:3000
```

## Configurare

### 1. Primul Utilizator
La prima accesare, vei fi ghidat să creezi un cont de administrator.

### 2. SmartBill API
Din **Setări**, configurează:
- Email SmartBill
- Token API (din SmartBill Cloud → Setări → Integrări API)
- CIF-ul firmei

### 3. eMAG Marketplace (opțional)
Dacă dorești upload automat în eMAG:
- Username API Marketplace
- Parola API Marketplace

### 4. Nomenclator Produse
1. Du-te la **Nomenclator Produse**
2. Click **Actualizează din SmartBill**
3. Completează pentru fiecare produs:
   - Garanție PF (luni)
   - Garanție PJ (luni)
   - Tensiune alimentare
   - Tensiune minimă
   - Activ/Inactiv
4. Click **Salvează Modificările**

## Utilizare

### Procesare Automată
1. Du-te la **Certificate** → **Procesare Automată**
2. Setează ultima factură procesată (punct de plecare)
3. Click **Pornește Procesarea**
4. Descarcă PDF-urile generate

### Generare Manuală
1. Du-te la **Certificate** → **Generare Manuală**
2. Introdu numărul facturii (ex: PKF0001234)
3. Click **Generează**
4. Descarcă PDF-ul

## Structura Proiectului

```
├── src/
│   ├── config/          # Configurări (DB, constante)
│   ├── middleware/      # Middleware (auth)
│   ├── routes/          # Rute Express
│   ├── services/        # Servicii (SmartBill, eMAG, PDF)
│   ├── utils/           # Utilitare (criptare)
│   ├── views/           # Template-uri EJS
│   └── server.js        # Server principal
├── data/                # Baza de date SQLite (generat)
├── output/              # PDF-uri generate (generat)
├── templates/           # Template PDF certificat
└── .env                 # Configurare (de creat)
```

## Template PDF

Template-ul certificatului se află în `templates/Certificat de garantie Zulmire v2.pdf`.

Câmpurile care se înlocuiesc automat:
- `Products_1`, `Products_2`, `Products_3` - Produse cu garanție
- `warranty_terms` - Termenul de garanție în luni
- `client_name` - Numele clientului
- `invoice_no` - Numărul facturii
- `invoice_date` - Data facturii
- `tensiion_value` - Tensiunea minimă

## Deploy pe Server

### Cu PM2
```bash
npm install -g pm2
pm2 start src/server.js --name "garantie-premierkids"
pm2 save
pm2 startup
```

### Cu Nginx (reverse proxy)
```nginx
server {
    listen 80;
    server_name garantie.domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Variabile de mediu pentru producție
```env
NODE_ENV=production
PORT=3000
SESSION_SECRET=<generează-o-cheie-sigură>
ENCRYPTION_KEY=<generează-o-cheie-sigură-32-caractere>
```

## Securitate

- Parolele sunt hash-uite cu bcrypt (12 rounds)
- Credențialele API sunt criptate cu AES-256-GCM
- Sesiunile au timeout de 8 ore
- Rate limiting pentru prevenirea atacurilor brute-force
- CORS și Helmet pentru securitate HTTP

## Troubleshooting

### "Credențialele SmartBill nu sunt configurate"
- Verifică că ai salvat credențialele din Setări
- Verifică că ENCRYPTION_KEY din .env nu s-a schimbat

### "Template-ul PDF nu a fost găsit"
- Asigură-te că fișierul PDF există în `templates/`

### Erori la conectare SmartBill
- Verifică token-ul API
- Verifică că CIF-ul este corect
- Testează conexiunea din Setări

## Licență

Proprietar - PremierKids
