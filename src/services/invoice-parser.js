/**
 * Serviciu pentru parsarea facturilor PDF din SmartBill
 * Extrage datele relevante pentru certificatele de garanție
 */

const pdfParse = require('pdf-parse');

class InvoiceParserService {
    /**
     * Extrage datele din PDF-ul unei facturi SmartBill
     * @param {Buffer} pdfBuffer - Buffer-ul PDF-ului
     * @returns {Object} Datele extrase din factură
     */
    async parseInvoicePdf(pdfBuffer) {
        try {
            const data = await pdfParse(pdfBuffer);
            const text = data.text;

            // Extragem datele din text
            const invoiceData = {
                invoiceNumber: this._extractInvoiceNumber(text),
                invoiceDate: this._extractInvoiceDate(text),
                clientName: this._extractClientName(text),
                clientCUI: this._extractClientCUI(text),
                isVatPayer: false,
                products: this._extractProducts(text),
                totalValue: this._extractTotalValue(text),
                emagOrderNumber: this._extractEmagOrderNumber(text),
                rawText: text // Pentru debugging
            };

            // Determinăm dacă clientul este plătitor de TVA (PJ cu CUI)
            invoiceData.isVatPayer = this._isVatPayer(invoiceData.clientCUI, text);

            return {
                success: true,
                data: invoiceData
            };
        } catch (error) {
            return {
                success: false,
                error: `Eroare la parsarea PDF-ului: ${error.message}`
            };
        }
    }

    /**
     * Extrage numărul comenzii eMAG din factură
     * Pattern: "Comanda Emag nr. 469620603"
     */
    _extractEmagOrderNumber(text) {
        // Pattern-uri pentru numărul comenzii eMAG
        const patterns = [
            /Comanda\s+Emag\s+nr\.?\s*(\d+)/i,
            /Nr\.?\s+comanda\s+Emag[:\s]*(\d+)/i,
            /eMAG\s+order[:\s#]*(\d+)/i,
            /Comanda\s+#?\s*(\d{8,12})/i  // Număr de 8-12 cifre care ar putea fi comandă eMAG
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                console.log(`[Parser] Număr comandă eMAG extras: ${match[1]}`);
                return match[1];
            }
        }

        return null;
    }

    /**
     * Extrage numărul facturii
     */
    _extractInvoiceNumber(text) {
        // Căutăm pattern-uri comune pentru număr factură
        // Ex: "Factura Seria PKF Nr. 202124601" sau "FACTURA PKF 202124601"
        const patterns = [
            /Factura\s+Seria\s+(\w+)\s+Nr\.?\s*(\d+)/i,
            /FACTURA\s+(\w+)\s*(\d+)/i,
            /Seria:\s*(\w+)\s*Nr\.?:?\s*(\d+)/i,
            /Serie:\s*(\w+)\s*Numar:?\s*(\d+)/i,
            /(\w{2,5})[\s-]*(\d{6,12})/  // Pattern generic: PKF202124601
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return `${match[1]}${match[2]}`;
            }
        }

        return null;
    }

    /**
     * Extrage data facturii
     */
    _extractInvoiceDate(text) {
        // Căutăm pattern-uri pentru dată
        // Ex: "Data: 14.12.2024" sau "14/12/2024" sau "2024-12-14"
        const patterns = [
            /Data(?:\s+facturii)?[:\s]+(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/i,
            /Data\s+emiterii[:\s]+(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/i,
            /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/  // Prima dată găsită
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const day = match[1].padStart(2, '0');
                const month = match[2].padStart(2, '0');
                const year = match[3];
                return `${day}.${month}.${year}`;
            }
        }

        return null;
    }

    /**
     * Extrage numele clientului
     */
    _extractClientName(text) {
        // Căutăm secțiunea client/cumpărător
        const patterns = [
            /(?:Client|Cumparator|Cumpărător|Beneficiar)[:\s]+([^\n\r]+)/i,
            /(?:Nume|Denumire)[:\s]+([^\n\r]+)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                let name = match[1].trim();
                // Curățăm numele de caractere nedorite
                name = name.replace(/CUI.*$/i, '').trim();
                name = name.replace(/C\.?U\.?I\.?.*$/i, '').trim();
                name = name.replace(/\s{2,}/g, ' ');
                if (name.length > 3 && name.length < 100) {
                    return name;
                }
            }
        }

        return null;
    }

    /**
     * Extrage CUI-ul clientului
     */
    _extractClientCUI(text) {
        // Căutăm CUI sau CIF
        const patterns = [
            /C\.?U\.?I\.?[:\s]*(?:RO)?(\d{6,10})/i,
            /C\.?I\.?F\.?[:\s]*(?:RO)?(\d{6,10})/i,
            /(?:RO)?(\d{6,10})/  // Număr generic care ar putea fi CUI
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Determină dacă clientul este PJ (Persoană Juridică) sau PF (Persoană Fizică)
     *
     * LOGICA CORECTĂ:
     * - Dacă găsim "Platitor TVA" urmat de "Nu" sau "NU" -> PF (chiar dacă are CUI)
     * - Dacă găsim "Platitor TVA" urmat de "Da" sau "DA" -> PJ
     * - Dacă găsim CNP (13 cifre) -> PF
     * - Default: PF (pentru siguranță, garanția PF este de obicei mai mare)
     *
     * NOTĂ: NU mai verificăm CUI cu RO deoarece acesta poate fi CIF-ul vânzătorului!
     */
    _isVatPayer(cui, text) {
        // Încercăm să izolăm secțiunea clientului din factură
        // În facturile SmartBill, secțiunea clientului este de obicei între "Client:" și alt marker
        let clientSection = text;

        // Încercăm să extragem doar secțiunea client/cumpărător
        const clientSectionMatch = text.match(/(?:Client|Cumparator|Cumpărător|Beneficiar)[:\s]+([\s\S]*?)(?:Produs|Denumire produs|Nr\.\s*crt|Total|FACTURA)/i);
        if (clientSectionMatch) {
            clientSection = clientSectionMatch[1];
            console.log('[Parser] Secțiune client izolată:', clientSection.substring(0, 200));
        }

        // 1. PRIORITAR: Verificăm câmpul "Platitor TVA" din SmartBill (cel mai fiabil)
        // Pattern extins: "Platitor TVA" poate fi urmat de ":" sau spații și apoi "Nu" sau "Da"
        // Căutăm în mai multe formate posibile
        const platitorPatterns = [
            /pl[aă]titor\s+(?:de\s+)?TVA[:\s]*([DNdn][aAuU])/i,
            /pl[aă]titor\s+TVA[:\s\n]*([DNdn][aAuU])/i,
            /TVA[:\s]*([DNdn][aAuU])\s*$/im,  // La sfârșitul unei linii
            /Platitor\s*TVA\s*[:\s]*\n*\s*([DNdn][aAuU])/im  // Cu newline între
        ];

        for (const pattern of platitorPatterns) {
            const match = clientSection.match(pattern);
            if (match) {
                const value = match[1].toLowerCase();
                if (value === 'nu') {
                    console.log('[Parser] Detectat "Plătitor TVA: Nu" în secțiunea client - client PF');
                    return false; // PF
                } else if (value === 'da') {
                    console.log('[Parser] Detectat "Plătitor TVA: Da" în secțiunea client - client PJ');
                    return true; // PJ
                }
            }
        }

        // Căutăm și în textul complet dacă nu am găsit în secțiunea client
        for (const pattern of platitorPatterns) {
            const match = text.match(pattern);
            if (match) {
                const value = match[1].toLowerCase();
                if (value === 'nu') {
                    console.log('[Parser] Detectat "Plătitor TVA: Nu" - client PF');
                    return false; // PF
                } else if (value === 'da') {
                    console.log('[Parser] Detectat "Plătitor TVA: Da" - client PJ');
                    return true; // PJ
                }
            }
        }

        // 2. Verificăm dacă există CNP (13 cifre) în secțiunea client - acesta indică PF
        const cnpPattern = /(?:CNP|C\.N\.P\.?)[:\s]*(\d{13})/i;
        if (cnpPattern.test(clientSection)) {
            console.log('[Parser] Detectat CNP în secțiunea client - client PF');
            return false; // PF
        }

        // 3. Verificăm dacă există un CNP direct în secțiunea client (13 cifre consecutive care încep cu 1,2,5,6)
        const cnpDirectPattern = /\b([1256]\d{12})\b/;
        const cnpMatch = clientSection.match(cnpDirectPattern);
        if (cnpMatch) {
            console.log('[Parser] Detectat CNP direct în secțiunea client - client PF');
            return false; // PF
        }

        // 4. Verificăm dacă în secțiunea CLIENT (nu în tot documentul!) există CUI cu prefix RO
        // IMPORTANT: NU căutăm în tot textul pentru că ar găsi CIF-ul vânzătorului
        const clientRoMatch = clientSection.match(/RO\s*(\d{6,10})/i);
        if (clientRoMatch) {
            // Verificăm că nu e CIF-ul vânzătorului (de obicei 10651758 pentru PremierkidS)
            const cuiNumber = clientRoMatch[1];
            if (cuiNumber !== '10651758') { // CIF PremierkidS
                console.log('[Parser] Detectat CUI cu RO în secțiunea client - client PJ plătitor TVA');
                return true; // PJ
            }
        }

        // 5. Default: dacă nu am găsit indicatori clari, presupunem PF
        // Aceasta este opțiunea mai sigură deoarece garanția PF e de obicei mai mare
        console.log('[Parser] Niciun indicator clar TVA găsit - presupunem PF');
        return false; // PF
    }

    /**
     * Extrage produsele din factură
     * SmartBill are un format special unde produsul poate apărea pe mai multe linii
     */
    _extractProducts(text) {
        const products = [];
        const seenProducts = new Set();

        // Căutăm linii care conțin "Premier" și le combinăm cu liniile următoare
        // până când găsim o linie completă cu voltaj și culoare
        const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Căutăm linii care încep cu tipul produsului Premier
            // Ex: "Masinuta electrica 4x4 Premier...", "ATV electric Premier...", etc.
            if (line.toLowerCase().includes('premier') &&
                (line.toLowerCase().includes('electric') || line.toLowerCase().includes('masinuta') ||
                 line.toLowerCase().includes('atv') || line.toLowerCase().includes('motocicleta') ||
                 line.toLowerCase().includes('tractor') || line.toLowerCase().includes('kart'))) {

                let fullName = line;

                // Concatenăm cu liniile următoare până găsim o linie completă
                // (care conține voltaj ȘI culoare)
                let j = i + 1;
                while (j < lines.length && j < i + 5) {
                    const nextLine = lines[j];

                    // Stop dacă linia următoare e preț, cantitate sau alt produs
                    if (nextLine.match(/^[\d.,]+\s*(RON|Lei|buc|EUR)?$/i) ||
                        nextLine.match(/^(Total|Subtotal|TVA)/i) ||
                        nextLine.match(/^\d+\s*x\s*\d/) ||
                        (nextLine.toLowerCase().includes('premier') && nextLine.toLowerCase().includes('electric'))) {
                        break;
                    }

                    // Adăugăm linia dacă pare a fi continuare - doar cu spațiu, fără virgulă
                    if (nextLine.length > 2 && !nextLine.match(/^[\d.,]+$/)) {
                        fullName += ' ' + nextLine;
                    }

                    // Verificăm dacă am ajuns la o denumire completă (are voltaj și culoare)
                    if (/\d+V/i.test(fullName) &&
                        /(alb|negru|rosu|roșu|albastru|galben|verde|gri|portocaliu|roz|mov|argintiu)/i.test(fullName)) {
                        break;
                    }

                    j++;
                }

                // Curățăm numele - doar spații multiple
                fullName = fullName.replace(/\s+/g, ' ').trim();

                const normalizedName = fullName.toLowerCase();

                // Verificăm să nu fie duplicat și să aibă minim 30 caractere
                if (!seenProducts.has(normalizedName) && fullName.length >= 30) {
                    seenProducts.add(normalizedName);

                    products.push({
                        code: this._extractProductCode(fullName, text),
                        name: fullName,
                        quantity: 1
                    });

                    console.log(`[Parser] Produs găsit: "${fullName}"`);
                }
            }
        }

        console.log(`[Parser] Total produse extrase: ${products.length}`);
        return products;
    }

    /**
     * Extrage codul produsului (EAN) din text
     * Codul EAN are de obicei 13 cifre și apare aproape de numele produsului
     */
    _extractProductCode(productName, fullText) {
        // 1. Căutăm codul EAN (13 cifre care încep cu 64274700 - codul Premier)
        const eanPattern = /\b(64274700\d{5})\b/g;
        const eanMatches = [...fullText.matchAll(eanPattern)];

        if (eanMatches.length > 0) {
            // Dacă avem mai multe coduri EAN, încercăm să găsim cel mai apropiat de numele produsului
            const productIndex = fullText.indexOf(productName.substring(0, 30));

            if (productIndex !== -1 && eanMatches.length > 1) {
                // Găsim codul cel mai apropiat de produs
                let closestCode = eanMatches[0][1];
                let closestDistance = Math.abs(fullText.indexOf(eanMatches[0][1]) - productIndex);

                for (const match of eanMatches) {
                    const codeIndex = fullText.indexOf(match[1]);
                    const distance = Math.abs(codeIndex - productIndex);
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestCode = match[1];
                    }
                }
                console.log(`[Parser] Cod EAN extras pentru "${productName.substring(0, 30)}...": ${closestCode}`);
                return closestCode;
            }

            // Dacă avem un singur cod sau nu găsim produsul, returnăm primul
            console.log(`[Parser] Cod EAN extras: ${eanMatches[0][1]}`);
            return eanMatches[0][1];
        }

        // 2. Căutăm orice cod de 13 cifre (format EAN standard)
        const genericEanPattern = /\b(\d{13})\b/g;
        const genericEanMatches = [...fullText.matchAll(genericEanPattern)];

        if (genericEanMatches.length > 0) {
            console.log(`[Parser] Cod EAN generic extras: ${genericEanMatches[0][1]}`);
            return genericEanMatches[0][1];
        }

        // 3. Căutăm coduri de tip litere + cifre
        const codePatterns = [
            /([A-Z]{2,5}\d{3,10})/i,  // ex: PKF001234
        ];

        for (const pattern of codePatterns) {
            const match = fullText.match(pattern);
            if (match) {
                console.log(`[Parser] Cod alfanumeric extras: ${match[1]}`);
                return match[1];
            }
        }

        // 4. Fallback: folosim primul cuvânt din nume
        const firstWord = productName.split(/\s+/)[0].toUpperCase();
        console.log(`[Parser] Fallback cod: ${firstWord}`);
        return firstWord.length >= 2 ? firstWord : 'PREMIER';
    }

    /**
     * Extrage valoarea totală
     */
    _extractTotalValue(text) {
        const patterns = [
            /Total(?:\s+general)?[:\s]+(\d+[.,]?\d*)\s*(?:RON|Lei)?/i,
            /TOTAL[:\s]+(\d+[.,]?\d*)/i,
            /Total\s+de\s+plat[aă][:\s]+(\d+[.,]?\d*)/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return parseFloat(match[1].replace(',', '.'));
            }
        }

        return null;
    }

    /**
     * Potrivește produsele din factură cu nomenclatorul local
     * @param {Array} invoiceProducts - Produsele extrase din factură
     * @param {Object} productsService - Serviciul de produse pentru lookup
     * @returns {Array} Produsele potrivite cu date din nomenclator
     */
    matchProductsWithNomenclator(invoiceProducts, productsService) {
        const matchedProducts = [];

        for (const invoiceProduct of invoiceProducts) {
            console.log(`[Parser] Căutare produs: code="${invoiceProduct.code}", name="${invoiceProduct.name}"`);

            // Încercăm să găsim produsul în nomenclator după cod
            let localProduct = productsService.getProductByCode(invoiceProduct.code);
            console.log(`[Parser] Căutare după cod exact:`, localProduct ? `GĂSIT: ${localProduct.smartbill_name}` : 'NEGĂSIT');

            // Dacă nu găsim după cod exact, căutăm după denumire exactă
            if (!localProduct) {
                const allProducts = productsService.getAllProducts(true);
                const invoiceName = invoiceProduct.name.toLowerCase().trim();

                console.log(`[Parser] Căutare produs după denumire exactă: "${invoiceName}"`);

                // 1. Căutare EXACTĂ - denumirea din factură trebuie să fie identică cu cea din nomenclator
                localProduct = allProducts.find(p =>
                    p.smartbill_name.toLowerCase().trim() === invoiceName
                );

                // 2. Dacă nu găsim exact, căutăm dacă denumirea din nomenclator CONȚINE denumirea din factură
                if (!localProduct) {
                    localProduct = allProducts.find(p =>
                        p.is_active === 1 &&
                        p.smartbill_name.toLowerCase().includes(invoiceName)
                    );
                }

                // 3. Sau invers - denumirea din factură conține denumirea din nomenclator
                if (!localProduct) {
                    localProduct = allProducts.find(p =>
                        p.is_active === 1 &&
                        invoiceName.includes(p.smartbill_name.toLowerCase().trim())
                    );
                }

                console.log(`[Parser] Căutare după denumire:`, localProduct ? `GĂSIT: ${localProduct.smartbill_name}` : 'NEGĂSIT');
            }

            if (localProduct && localProduct.is_active === 1 && localProduct.is_new === 0) {
                matchedProducts.push({
                    code: localProduct.smartbill_code,
                    name: localProduct.display_name || localProduct.smartbill_name,
                    warranty_pf: localProduct.warranty_pf,
                    warranty_pj: localProduct.warranty_pj,
                    voltage_min: localProduct.voltage_min,
                    quantity: invoiceProduct.quantity || 1,
                    matched: true
                });
            } else {
                // Produsul nu a fost găsit în nomenclator
                matchedProducts.push({
                    code: invoiceProduct.code,
                    name: invoiceProduct.name,
                    quantity: invoiceProduct.quantity || 1,
                    matched: false,
                    reason: localProduct ? 'Produsul nu este configurat' : 'Produsul nu există în nomenclator'
                });
            }
        }

        return matchedProducts;
    }
}

// Singleton instance
const invoiceParserService = new InvoiceParserService();

module.exports = invoiceParserService;
