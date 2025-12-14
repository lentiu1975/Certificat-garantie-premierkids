/**
 * Serviciu pentru generarea certificatelor de garanție
 * Folosește pdf-lib pentru a completa form fields în template-ul PDF
 *
 * Template-ul PDF (v3) conține form fields:
 * - {product_1}, {product_2}, {product_3} - numele produselor
 * - {warranty_1}, {warranty_2}, {warranty_3} - garanția
 * - {client_name} - numele clientului
 * - {invoice_number} - numărul facturii
 * - {invoice_date} - data facturii
 * - {voltage_min} - tensiunea minimă pentru acumulator
 */

const { PDFDocument, PDFName, PDFString, PDFHexString, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const constants = require('../config/constants');

class PdfService {
    constructor() {
        this.pdfTemplatePath = null;
        this.pdfTemplateBytes = null;
    }

    /**
     * Încarcă template-ul PDF
     */
    async loadTemplate() {
        // Încercăm mai întâi v3 (cu form fields), apoi v2
        const possiblePaths = [
            path.resolve('templates/Certificat de garantie Zulmire v3.pdf'),
            path.resolve(constants.FILES.PDF_TEMPLATE_PATH || 'templates/Certificat de garantie Zulmire v2.pdf')
        ];

        for (const pdfPath of possiblePaths) {
            if (fs.existsSync(pdfPath)) {
                this.pdfTemplatePath = pdfPath;
                this.pdfTemplateBytes = fs.readFileSync(pdfPath);
                console.log('[PDF Service] Template PDF încărcat:', pdfPath);
                return true;
            }
        }

        throw new Error(`Template-ul PDF nu a fost găsit`);
    }

    /**
     * Generează un certificat de garanție completând form fields
     * @param {Object} data - Datele pentru certificat
     */
    async generateCertificate(data) {
        await this.loadTemplate();

        const {
            clientName,
            invoiceNumber,
            invoiceDate,
            products,
            minVoltage
        } = data;

        // Încărcăm PDF-ul template
        const pdfDoc = await PDFDocument.load(this.pdfTemplateBytes);

        // Încărcăm fontul Helvetica pentru text
        const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

        // Obținem formularul
        const form = pdfDoc.getForm();

        // Listăm toate câmpurile disponibile pentru debug
        const fields = form.getFields();
        console.log('[PDF Service] Câmpuri disponibile:', fields.map(f => f.getName()));

        // Garanția default
        const defaultWarranty = 24;

        // Dimensiunea fontului pentru câmpuri
        const fontSize = 11;
        const productFontSize = 9; // Font mai mic pentru produse (să încapă tot textul)

        // Funcție helper pentru a găsi un câmp cu diverse variante de nume
        const findField = (baseName) => {
            const variations = [
                baseName,
                `{${baseName}}`,
                `undefined.{${baseName}}`,
                `undefined.${baseName}`
            ];

            for (const name of variations) {
                try {
                    const field = form.getTextField(name);
                    if (field) {
                        console.log(`[PDF Service] Găsit câmp: ${name}`);
                        return field;
                    }
                } catch (e) {
                    // Câmpul nu există cu acest nume
                }
            }
            console.log(`[PDF Service] Câmpul ${baseName} nu a fost găsit`);
            return null;
        };

        // Funcție helper pentru a normaliza textul (înlocuiește diacritice)
        const normalizeText = (text) => {
            if (!text) return text;
            return text
                .replace(/ă/g, 'a').replace(/Ă/g, 'A')
                .replace(/â/g, 'a').replace(/Â/g, 'A')
                .replace(/î/g, 'i').replace(/Î/g, 'I')
                .replace(/ș/g, 's').replace(/Ș/g, 'S')
                .replace(/ț/g, 't').replace(/Ț/g, 'T');
        };

        // Funcție helper pentru a formata numele produsului
        // Nu mai scurtăm - folosim font mai mic pentru a încăpea tot textul
        const formatProductName = (name) => {
            if (!name) return '';
            // Curățăm spațiile multiple și trimăm
            return name.trim().replace(/\s+/g, ' ');
        };

        // Funcție helper pentru a seta textul în câmp cu font și dimensiune
        const setFieldText = (field, text, customFontSize = null) => {
            if (!field) return;
            try {
                // Normalizăm textul (fără diacritice) și setăm direct
                const normalizedText = normalizeText(text);
                field.setText(normalizedText);
                // Setăm fontul și dimensiunea
                field.updateAppearances(helveticaFont);
                // Folosim dimensiunea custom sau cea default
                field.setFontSize(customFontSize || fontSize);
            } catch (e) {
                console.log(`[PDF Service] Eroare la setarea câmpului: ${e.message}`);
            }
        };

        // Completăm câmpurile - produs și garanție combinate în product_X
        // Produs 1
        // Produs 1 - nume în product_1, garanție în warranty_1
        const product1Field = findField('product_1');
        if (product1Field) {
            if (products?.[0]?.name) {
                const productName = formatProductName(products[0].name);
                setFieldText(product1Field, `1. ${productName}`, productFontSize);
            } else {
                setFieldText(product1Field, '', productFontSize);
            }
        }
        const warranty1Field = findField('warranty_1');
        if (warranty1Field) {
            if (products?.[0]?.name) {
                const warranty = products[0].warrantyMonths || defaultWarranty;
                setFieldText(warranty1Field, `garantie (luni): ${warranty}`, productFontSize);
            } else {
                setFieldText(warranty1Field, '', productFontSize);
            }
        }

        // Produs 2
        const product2Field = findField('product_2');
        if (product2Field) {
            if (products?.[1]?.name) {
                const productName = formatProductName(products[1].name);
                setFieldText(product2Field, `2. ${productName}`, productFontSize);
            } else {
                setFieldText(product2Field, '', productFontSize);
            }
        }
        const warranty2Field = findField('warranty_2');
        if (warranty2Field) {
            if (products?.[1]?.name) {
                const warranty = products[1].warrantyMonths || defaultWarranty;
                setFieldText(warranty2Field, `garantie (luni): ${warranty}`, productFontSize);
            } else {
                setFieldText(warranty2Field, '', productFontSize);
            }
        }

        // Produs 3
        const product3Field = findField('product_3');
        if (product3Field) {
            if (products?.[2]?.name) {
                const productName = formatProductName(products[2].name);
                setFieldText(product3Field, `3. ${productName}`, productFontSize);
            } else {
                setFieldText(product3Field, '', productFontSize);
            }
        }
        const warranty3Field = findField('warranty_3');
        if (warranty3Field) {
            if (products?.[2]?.name) {
                const warranty = products[2].warrantyMonths || defaultWarranty;
                setFieldText(warranty3Field, `garantie (luni): ${warranty}`, productFontSize);
            } else {
                setFieldText(warranty3Field, '', productFontSize);
            }
        }

        // Client
        const clientField = findField('client_name');
        if (clientField) {
            setFieldText(clientField, clientName || '');
        }

        // Factură
        const invoiceNumField = findField('invoice_number');
        if (invoiceNumField) {
            setFieldText(invoiceNumField, invoiceNumber || '');
        }

        const invoiceDateField = findField('invoice_date');
        if (invoiceDateField) {
            setFieldText(invoiceDateField, invoiceDate || '');
        }

        // Tensiune minimă - font mai mic (8pt) pentru a se încadra în textul condițiilor
        const voltageField = findField('voltage_min');
        if (voltageField) {
            setFieldText(voltageField, minVoltage || '10.8', 8);
        }

        // Marcăm câmpurile ca read-only (nu flatten, care are bug-uri cu acest template)
        const allFields = form.getFields();
        for (const field of allFields) {
            try {
                field.enableReadOnly();
            } catch (e) {
                // Ignorăm erorile
            }
        }

        // Salvăm PDF-ul
        const pdfBytes = await pdfDoc.save();

        console.log('[PDF Service] PDF generat cu succes, size:', pdfBytes.length);
        return Buffer.from(pdfBytes);
    }

    /**
     * Salvează documentul PDF pe disc
     * @param {Buffer} pdfBuffer - Buffer-ul documentului PDF
     * @param {string} invoiceNumber - Numărul facturii
     */
    async savePdf(pdfBuffer, invoiceNumber) {
        const outputDir = path.resolve(constants.FILES.OUTPUT_PATH);

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const pdfFilename = `Certificat_Garantie_${invoiceNumber}.pdf`;
        const pdfPath = path.join(outputDir, pdfFilename);
        fs.writeFileSync(pdfPath, pdfBuffer);

        console.log('[PDF Service] PDF salvat:', pdfPath);

        return {
            path: pdfPath,
            filename: pdfFilename
        };
    }

    /**
     * Obține calea către un document generat
     */
    getPdfPath(invoiceNumber) {
        const outputDir = path.resolve(constants.FILES.OUTPUT_PATH);
        return path.join(outputDir, `Certificat_Garantie_${invoiceNumber}.pdf`);
    }

    /**
     * Verifică dacă un PDF există
     */
    pdfExists(invoiceNumber) {
        const pdfPath = this.getPdfPath(invoiceNumber);
        return fs.existsSync(pdfPath);
    }

    /**
     * Obține extensia fișierului certificat
     */
    getCertificateExtension(invoiceNumber) {
        return 'pdf';
    }
}

// Singleton instance
const pdfService = new PdfService();

module.exports = pdfService;
