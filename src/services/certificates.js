/**
 * Serviciu pentru gestionarea certificatelor de garanție
 * Coordonează procesarea facturilor și generarea PDF-urilor
 */

const { db } = require('../config/database');
const smartBillService = require('./smartbill');
const productsService = require('./products');
const pdfService = require('./pdf');
const emagService = require('./emag');
const invoiceParserService = require('./invoice-parser');
const constants = require('../config/constants');

class CertificatesService {
    /**
     * Obține ultima factură procesată
     */
    getLastProcessedInvoice() {
        const stmt = db.prepare("SELECT value FROM app_config WHERE key = 'last_processed_invoice'");
        const result = stmt.get();
        return result ? result.value : '';
    }

    /**
     * Setează ultima factură procesată
     */
    setLastProcessedInvoice(invoiceNumber) {
        const stmt = db.prepare(`
            INSERT INTO app_config (key, value, updated_at)
            VALUES ('last_processed_invoice', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(invoiceNumber);
        console.log(`[Certificates] Ultima factură procesată setată: ${invoiceNumber}`);
    }

    /**
     * Salvează certificatul în baza de date
     */
    saveCertificateRecord(data) {
        const stmt = db.prepare(`
            INSERT INTO certificates (
                invoice_number, invoice_date, client_name, client_is_vat_payer,
                products_json, emag_order_number, emag_uploaded, pdf_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            data.invoiceNumber,
            data.invoiceDate,
            data.clientName,
            data.isVatPayer ? 1 : 0,
            JSON.stringify(data.products),
            data.emagOrderNumber || null,
            data.emagUploaded ? 1 : 0,
            data.pdfPath || null
        );

        return result.lastInsertRowid;
    }

    /**
     * Procesează o singură factură și generează certificat dacă e cazul
     */
    async processInvoice(series, number) {
        // Obținem detaliile facturii din SmartBill
        const invoice = await smartBillService.getInvoiceDetails(series, number);

        if (!invoice) {
            return {
                success: false,
                error: 'Factura nu a fost găsită',
                invoiceNumber: `${series}${number}`
            };
        }

        // Verificăm dacă clientul este plătitor de TVA
        const isVatPayer = smartBillService.isVatPayer(invoice);

        // Extragem produsele active din factură
        const activeProducts = [];
        let minVoltage = '';

        if (invoice.products && invoice.products.length > 0) {
            for (const invoiceProduct of invoice.products) {
                console.log(`[Certificates] Produs din factură: code="${invoiceProduct.code}", name="${invoiceProduct.name}"`);
                const localProduct = productsService.getProductByCode(invoiceProduct.code);
                console.log(`[Certificates] Produs găsit în nomenclator:`, localProduct ? `code="${localProduct.smartbill_code}", name="${localProduct.smartbill_name}"` : 'NEGĂSIT');

                if (localProduct && localProduct.is_active === 1) {
                    const warrantyMonths = isVatPayer ?
                        localProduct.warranty_pj :
                        localProduct.warranty_pf;

                    activeProducts.push({
                        code: invoiceProduct.code,
                        name: localProduct.display_name || localProduct.smartbill_name,
                        warrantyMonths: warrantyMonths,
                        quantity: invoiceProduct.quantity || 1
                    });

                    // Luăm tensiunea minimă de la primul produs activ
                    if (!minVoltage && localProduct.voltage_min) {
                        minVoltage = localProduct.voltage_min;
                    }
                }
            }
        }

        // Dacă nu sunt produse active, nu generăm certificat
        if (activeProducts.length === 0) {
            return {
                success: true,
                generated: false,
                message: 'Factura nu conține produse active pentru garanție',
                invoiceNumber: `${series}${number}`
            };
        }

        // Extragem numărul comenzii eMAG dacă există
        const emagOrderNumber = smartBillService.extractEmagOrderNumber(invoice);

        // Pregătim datele pentru certificat
        const certificateData = {
            clientName: invoice.client?.name || '',
            invoiceNumber: `${series}${number}`,
            invoiceDate: this._formatDate(invoice.issueDate),
            products: activeProducts.slice(0, 3), // Maxim 3 produse în template
            minVoltage: minVoltage,
            isVatPayer: isVatPayer,
            emagOrderNumber: emagOrderNumber
        };

        // Generăm PDF-ul
        const pdfBuffer = await pdfService.generateCertificate(certificateData);

        // Salvăm PDF-ul pe disc
        const savedPdf = await pdfService.savePdf(pdfBuffer, certificateData.invoiceNumber);

        // Încărcăm în eMAG dacă e cazul
        let emagUploaded = false;
        let emagError = null;

        if (emagOrderNumber && emagService.isConfigured()) {
            try {
                const uploadResult = await emagService.uploadWarrantyCertificate(
                    emagOrderNumber,
                    pdfBuffer,
                    savedPdf.filename
                );
                emagUploaded = uploadResult.success;
                if (!uploadResult.success) {
                    emagError = uploadResult.error;
                }
            } catch (error) {
                emagError = error.message;
            }
        }

        // Salvăm înregistrarea în baza de date
        this.saveCertificateRecord({
            invoiceNumber: certificateData.invoiceNumber,
            invoiceDate: certificateData.invoiceDate,
            clientName: certificateData.clientName,
            isVatPayer: isVatPayer,
            products: activeProducts,
            emagOrderNumber: emagOrderNumber,
            emagUploaded: emagUploaded,
            pdfPath: savedPdf.path
        });

        return {
            success: true,
            generated: true,
            invoiceNumber: certificateData.invoiceNumber,
            clientName: certificateData.clientName,
            productsCount: activeProducts.length,
            pdfPath: savedPdf.path,
            pdfFilename: savedPdf.filename,
            pdfBuffer: pdfBuffer,
            emagOrderNumber: emagOrderNumber,
            emagUploaded: emagUploaded,
            emagError: emagError
        };
    }

    /**
     * Procesează automat facturile neprocessate
     * Funcționează prin iterare consecutivă de numere de facturi (ca la generarea manuală)
     * SmartBill nu are endpoint pentru listare facturi, așa că iterăm prin numere consecutive
     */
    async processUnprocessedInvoices(options = {}) {
        const { maxInvoices = 50 } = options;

        // Obținem ultima factură procesată
        const lastProcessed = this.getLastProcessedInvoice();

        if (!lastProcessed) {
            return {
                success: false,
                error: 'Trebuie să setați ultima factură procesată înainte de procesarea automată. Introduceți numărul ultimei facturi procesate (ex: PK202124575).'
            };
        }

        // Parsăm ultima factură procesată pentru a obține seria și numărul
        const { series, number } = this._parseInvoiceIdentifier(lastProcessed);

        if (!series || !number) {
            return {
                success: false,
                error: `Format invalid pentru ultima factură procesată: ${lastProcessed}. Folosiți formatul: PK202124575`
            };
        }

        const startNumber = parseInt(number, 10);
        if (isNaN(startNumber)) {
            return {
                success: false,
                error: `Numărul facturii trebuie să fie numeric: ${number}`
            };
        }

        const results = {
            total: 0,           // Total încercări
            processed: 0,       // Facturi care au existat (generated + skipped)
            generated: 0,       // Certificate generate
            skipped: 0,         // Facturi fără produse active
            notFound: 0,        // Facturi inexistente (404)
            errors: [],
            certificates: []
        };

        let consecutiveNotFound = 0;
        const maxConsecutiveNotFound = 2; // Oprim după 2 facturi consecutive negăsite
        let lastExistingInvoice = lastProcessed; // Ținem evidența ultimei facturi EXISTENTE

        // Iterăm prin numerele consecutive de facturi
        for (let i = 1; i <= maxInvoices; i++) {
            const currentNumber = String(startNumber + i);
            const invoiceIdentifier = `${series}${currentNumber}`;

            console.log(`[Auto] Procesare factură ${i}/${maxInvoices}: ${invoiceIdentifier}`);

            try {
                // Folosim aceeași metodă ca la generarea manuală
                const result = await this.processInvoiceFromPdf(series, currentNumber);

                results.total++;
                results.processed++;
                consecutiveNotFound = 0; // Reset counter
                lastExistingInvoice = invoiceIdentifier; // Actualizăm ultima factură existentă

                if (result.generated) {
                    results.generated++;
                    results.certificates.push({
                        invoiceNumber: result.invoiceNumber,
                        clientName: result.clientName,
                        pdfFilename: result.pdfFilename,
                        emagOrderNumber: result.emagOrderNumber,
                        emagUploaded: result.emagUploaded
                    });
                } else {
                    results.skipped++;
                }

            } catch (error) {
                results.total++;

                // Verificăm dacă e eroare care indică că factura nu există
                // SmartBill poate returna diverse erori pentru facturi inexistente:
                // - 404 / Not Found
                // - Parse Error: Invalid header token (răspuns malformat pentru facturi inexistente)
                // - NEPOTRIVIRE (când PDF-ul returnat e pentru altă factură)
                const errorMsg = error.message.toLowerCase();
                const isNotFoundError =
                    errorMsg.includes('404') ||
                    errorMsg.includes('not found') ||
                    errorMsg.includes('parse error') ||
                    errorMsg.includes('invalid header') ||
                    errorMsg.includes('nepotrivire') ||
                    errorMsg.includes('nu a fost găsită');

                if (isNotFoundError) {
                    results.notFound++;
                    consecutiveNotFound++;

                    console.log(`[Auto] Factura ${invoiceIdentifier} nu există (${consecutiveNotFound}/${maxConsecutiveNotFound} consecutive)`);

                    // Oprim dacă am găsit prea multe facturi consecutive inexistente
                    if (consecutiveNotFound >= maxConsecutiveNotFound) {
                        console.log(`[Auto] Oprire: ${maxConsecutiveNotFound} facturi consecutive nu au fost găsite`);
                        break;
                    }
                } else {
                    // Altă eroare - o înregistrăm dar continuăm
                    consecutiveNotFound = 0;
                    console.error(`[Auto] EROARE pentru ${invoiceIdentifier}:`, error.message);
                    results.errors.push({
                        invoiceNumber: invoiceIdentifier,
                        error: error.message
                    });
                }
            }
            // Nu mai adăugăm pauză suplimentară - SmartBill rate limiting deja impune 2 secunde
        }

        // Salvăm ultima factură EXISTENTĂ procesată (nu cea cu care am încercat și nu am găsit-o)
        if (lastExistingInvoice !== lastProcessed) {
            this.setLastProcessedInvoice(lastExistingInvoice);
            console.log(`[Auto] Ultima factură procesată actualizată: ${lastExistingInvoice}`);
        }

        return {
            success: true,
            message: `Procesare completă. Ultima factură existentă: ${lastExistingInvoice}`,
            lastProcessedInvoice: lastExistingInvoice,
            startedFrom: lastProcessed,
            searchedRange: `${series}${startNumber + 1} - ${series}${startNumber + results.total}`,
            // Statistici clare:
            // - total: câte facturi am încercat să descărcăm
            // - processed: câte facturi au EXISTAT efectiv (= generated + skipped)
            // - generated: câte certificate am generat
            // - skipped: câte facturi existente dar fără produse Premier
            // - notFound: câte facturi NU au existat (404)
            total: results.total,
            processed: results.processed,      // Doar facturile care au existat!
            generated: results.generated,
            skipped: results.skipped,
            notFound: results.notFound,
            errors: results.errors,
            certificates: results.certificates
        };
    }

    /**
     * Generează certificat pentru o factură specifică prin descărcarea și parsarea PDF-ului
     * Această metodă descarcă PDF-ul facturii de la SmartBill și extrage automat datele
     */
    async generateSingleCertificate(invoiceIdentifier) {
        // Parsăm identificatorul facturii (format: SERIE+NUMAR sau doar NUMAR)
        const { series, number } = this._parseInvoiceIdentifier(invoiceIdentifier);

        if (!series || !number) {
            return {
                success: false,
                error: 'Format factură invalid. Folosiți formatul: SERIE123 sau specificați seria și numărul'
            };
        }

        return await this.processInvoiceFromPdf(series, number);
    }

    /**
     * Procesează o factură prin descărcarea și parsarea PDF-ului de la SmartBill
     */
    async processInvoiceFromPdf(series, number) {
        const invoiceNumber = `${series}${number}`;

        try {
            // 1. Descărcăm PDF-ul facturii de la SmartBill
            console.log(`Descărcare PDF pentru factura ${invoiceNumber}...`);
            const pdfBuffer = await smartBillService.getInvoicePdf(series, number);

            if (!pdfBuffer || pdfBuffer.length === 0) {
                return {
                    success: false,
                    error: 'Nu s-a putut descărca PDF-ul facturii de la SmartBill'
                };
            }

            // 2. Parsăm PDF-ul pentru a extrage datele
            console.log('Parsare PDF...');
            const parseResult = await invoiceParserService.parseInvoicePdf(pdfBuffer);

            if (!parseResult.success) {
                return {
                    success: false,
                    error: parseResult.error
                };
            }

            const invoiceData = parseResult.data;
            console.log('Date extrase din PDF:', JSON.stringify(invoiceData, null, 2));

            // 2.5 VERIFICARE CRITICĂ: Confirmăm că PDF-ul descărcat corespunde facturii cerute
            // SmartBill poate returna un PDF gol/template pentru facturi inexistente
            const parsedInvoiceNumber = invoiceData.invoiceNumber;
            if (!parsedInvoiceNumber) {
                console.log(`[Certificates] PDF pentru ${invoiceNumber} nu conține număr de factură - probabil factură inexistentă`);
                throw new Error(`SmartBill PDF Error: 404 - Factura ${invoiceNumber} nu a fost găsită (PDF fără număr factură)`);
            }

            // Extragem doar cifrele din numerele de factură pentru comparație exactă
            // Ex: cerut "PK202124602" -> extrage "202124602" sau "24602"
            // Ex: parsat "PK202124601" -> extrage "202124601" sau "24601"
            const requestedDigits = invoiceNumber.replace(/[^0-9]/g, ''); // "202124602"
            const parsedDigits = parsedInvoiceNumber.replace(/[^0-9]/g, ''); // "202124601"

            // Comparație STRICTĂ: ultimele 5 cifre trebuie să se potrivească exact
            // (numărul facturii în SmartBill e de obicei 5 cifre, ex: 24601, 24602)
            const requestedSuffix = requestedDigits.slice(-5); // "24602"
            const parsedSuffix = parsedDigits.slice(-5); // "24601"

            console.log(`[Certificates] Verificare factură: cerut=${invoiceNumber} (suffix=${requestedSuffix}), găsit=${parsedInvoiceNumber} (suffix=${parsedSuffix})`);

            if (requestedSuffix !== parsedSuffix) {
                console.log(`[Certificates] NEPOTRIVIRE: Cerut factură cu suffix ${requestedSuffix}, dar PDF conține suffix ${parsedSuffix}`);
                throw new Error(`SmartBill PDF Error: 404 - Factura ${invoiceNumber} nu a fost găsită (PDF returnează altă factură: ${parsedInvoiceNumber})`);
            }

            console.log(`[Certificates] Verificare OK: Factură cerută ${invoiceNumber}, găsită ${parsedInvoiceNumber}`);

            // 3. Potrivim produsele cu nomenclatorul local
            const matchedProducts = invoiceParserService.matchProductsWithNomenclator(
                invoiceData.products,
                productsService
            );

            // Filtrăm doar produsele găsite în nomenclator
            const activeProducts = matchedProducts.filter(p => p.matched);

            if (activeProducts.length === 0) {
                return {
                    success: true,
                    generated: false,
                    message: 'Factura nu conține produse Premier configurate în nomenclator',
                    invoiceNumber: invoiceNumber,
                    extractedProducts: invoiceData.products,
                    unmatchedProducts: matchedProducts.filter(p => !p.matched)
                };
            }

            // 4. Determinăm garanția în funcție de tipul clientului
            const isVatPayer = invoiceData.isVatPayer;
            const productsWithWarranty = activeProducts.map(p => ({
                code: p.code,
                name: p.name,
                warrantyMonths: isVatPayer ? p.warranty_pj : p.warranty_pf,
                quantity: p.quantity
            }));

            // 5. Găsim tensiunea minimă de la primul produs
            const minVoltage = activeProducts[0]?.voltage_min || '';

            // 6. Extragem numărul de comandă eMAG din datele parsate
            const emagOrderNumber = invoiceData.emagOrderNumber || null;

            // 7. Pregătim datele pentru certificat
            const certificateData = {
                clientName: invoiceData.clientName || 'Client',
                invoiceNumber: invoiceNumber,
                invoiceDate: invoiceData.invoiceDate || this._formatDate(new Date().toISOString()),
                products: productsWithWarranty.slice(0, 3),
                minVoltage: minVoltage,
                isVatPayer: isVatPayer,
                emagOrderNumber: emagOrderNumber
            };

            // 8. Generăm PDF-ul certificatului
            const certPdfBuffer = await pdfService.generateCertificate(certificateData);

            // 9. Salvăm PDF-ul pe disc
            const savedPdf = await pdfService.savePdf(certPdfBuffer, invoiceNumber);

            // 10. Salvăm înregistrarea în baza de date
            this.saveCertificateRecord({
                invoiceNumber: invoiceNumber,
                invoiceDate: certificateData.invoiceDate,
                clientName: certificateData.clientName,
                isVatPayer: isVatPayer,
                products: productsWithWarranty,
                emagOrderNumber: emagOrderNumber,
                emagUploaded: false,
                pdfPath: savedPdf.path
            });

            return {
                success: true,
                generated: true,
                invoiceNumber: invoiceNumber,
                clientName: certificateData.clientName,
                clientType: isVatPayer ? 'PJ' : 'PF',
                invoiceDate: certificateData.invoiceDate,
                productsCount: productsWithWarranty.length,
                products: productsWithWarranty,
                pdfPath: savedPdf.path,
                pdfFilename: savedPdf.filename,
                emagOrderNumber: emagOrderNumber,
                extractedData: {
                    rawProducts: invoiceData.products,
                    matchedProducts: matchedProducts
                }
            };

        } catch (error) {
            console.error('Eroare la procesarea facturii:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generează certificat cu date introduse manual
     * @param {Object} data - Datele pentru certificat
     */
    async generateManualCertificate(data) {
        const { invoiceNumber, invoiceDate, clientName, isVatPayer, products, minVoltage } = data;

        if (!products || products.length === 0) {
            return {
                success: false,
                error: 'Selectați cel puțin un produs'
            };
        }

        // Pregătim datele pentru certificat
        const certificateData = {
            clientName: clientName,
            invoiceNumber: invoiceNumber,
            invoiceDate: invoiceDate,
            products: products.slice(0, 3), // Maxim 3 produse în template
            minVoltage: minVoltage || '',
            isVatPayer: isVatPayer,
            emagOrderNumber: null
        };

        // Generăm PDF-ul
        const pdfBuffer = await pdfService.generateCertificate(certificateData);

        // Salvăm PDF-ul pe disc
        const savedPdf = await pdfService.savePdf(pdfBuffer, certificateData.invoiceNumber);

        // Salvăm înregistrarea în baza de date
        this.saveCertificateRecord({
            invoiceNumber: certificateData.invoiceNumber,
            invoiceDate: certificateData.invoiceDate,
            clientName: certificateData.clientName,
            isVatPayer: isVatPayer,
            products: products,
            emagOrderNumber: null,
            emagUploaded: false,
            pdfPath: savedPdf.path
        });

        return {
            success: true,
            generated: true,
            invoiceNumber: certificateData.invoiceNumber,
            clientName: certificateData.clientName,
            productsCount: products.length,
            pdfPath: savedPdf.path,
            pdfFilename: savedPdf.filename,
            pdfBuffer: pdfBuffer
        };
    }

    /**
     * Obține istoricul certificatelor generate
     */
    getCertificatesHistory(limit = 100, offset = 0) {
        const stmt = db.prepare(`
            SELECT * FROM certificates
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);
        return stmt.all(limit, offset);
    }

    /**
     * Obține un certificat după ID
     */
    getCertificateById(id) {
        const stmt = db.prepare('SELECT * FROM certificates WHERE id = ?');
        return stmt.get(id);
    }

    /**
     * Obține buffer-ul PDF pentru un certificat
     */
    async getCertificatePdf(invoiceNumber) {
        const pdfPath = pdfService.getPdfPath(invoiceNumber);

        if (!pdfService.pdfExists(invoiceNumber)) {
            return null;
        }

        const fs = require('fs');
        return fs.readFileSync(pdfPath);
    }

    /**
     * Parsează identificatorul facturii
     * Suportă mai multe formate:
     * - "PK202124601" -> Serie: PK2021, Nr: 24601 (dacă seria conține anul)
     * - "PK24601" -> Serie: PK, Nr: 24601
     * - "PKF0001234" -> Serie: PKF, Nr: 0001234
     * - "24601" -> Serie: PK (implicit), Nr: 24601
     */
    _parseInvoiceIdentifier(identifier) {
        identifier = identifier.trim().toUpperCase();

        // Pattern pentru serie cu an (ex: PK2021) + număr
        // Formatul tipic PremierKids: PK + AN + NUMĂR (5 cifre)
        const seriesWithYearMatch = identifier.match(/^([A-Z]+)(\d{4})(\d{4,6})$/);
        if (seriesWithYearMatch) {
            const series = seriesWithYearMatch[1] + seriesWithYearMatch[2]; // PK2021
            const number = seriesWithYearMatch[3]; // 24601
            console.log(`[Parser] Detectat format cu an: Serie=${series}, Număr=${number}`);
            return { series, number };
        }

        // Pattern pentru serie simplă + număr lung (ex: PK24601)
        const simpleMatch = identifier.match(/^([A-Z]{2,5})(\d+)$/);
        if (simpleMatch) {
            const series = simpleMatch[1];
            const number = simpleMatch[2];
            console.log(`[Parser] Detectat format simplu: Serie=${series}, Număr=${number}`);
            return { series, number };
        }

        // Pattern cu spațiu sau separator
        const separatorMatch = identifier.match(/^([A-Z0-9]+)[.\s-]+(\d+)$/);
        if (separatorMatch) {
            console.log(`[Parser] Detectat format cu separator: Serie=${separatorMatch[1]}, Număr=${separatorMatch[2]}`);
            return {
                series: separatorMatch[1],
                number: separatorMatch[2]
            };
        }

        // Dacă e doar un număr, presupunem seria implicită PK
        if (/^\d+$/.test(identifier)) {
            console.log(`[Parser] Doar număr detectat, folosim seria PK: Număr=${identifier}`);
            return {
                series: 'PK',
                number: identifier
            };
        }

        console.log(`[Parser] Format nerecunoscut: ${identifier}`);
        return { series: null, number: null };
    }

    /**
     * Formatează data
     */
    _formatDate(dateString) {
        if (!dateString) return '';

        const date = new Date(dateString);
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();

        return `${day}.${month}.${year}`;
    }

    /**
     * Obține data de start implicită (30 zile în urmă)
     */
    _getDefaultStartDate() {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString().split('T')[0];
    }

    /**
     * Obține data curentă
     */
    _getCurrentDate() {
        return new Date().toISOString().split('T')[0];
    }
}

// Singleton instance
const certificatesService = new CertificatesService();

module.exports = certificatesService;
