import fs from 'fs';
import csv from 'csv-parser';

export class CSVService {
  async parseCSV(filePath) {
    return new Promise((resolve, reject) => {
      const contacts = [];
      
      if (!fs.existsSync(filePath)) {
        reject(new Error('Arquivo CSV não encontrado'));
        return;
      }

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          // Procura pela coluna 'number' especificamente
          const phoneNumber = row.number || row.Number || row.NUMBER;
          
          if (phoneNumber) {
            const cleanNumber = this.cleanPhoneNumber(phoneNumber);
            
            if (cleanNumber) {
              contacts.push({
                number: cleanNumber,
                original: phoneNumber.toString(),
                rowData: row
              });
            }
          }
        })
        .on('end', () => {
          console.log(`📋 ${contacts.length} números carregados do CSV`);
          resolve(contacts);
        })
        .on('error', (error) => {
          console.error('❌ Erro ao ler CSV:', error);
          reject(new Error('Erro ao processar CSV: ' + error.message));
        });
    });
  }

cleanPhoneNumber(phoneStr) {
    if (!phoneStr) return null;

    // Remove todos os caracteres não numéricos
    let cleaned = phoneStr.toString().replace(/\D/g, '');

    // Se o número já tem o formato DDI + DDD + 9 + 8 dígitos
    if (cleaned.length === 13 && cleaned.startsWith('55')) {
      return cleaned;
    }

    // Se tem 11 dígitos (DDD + 9 + 8 dígitos)
    if (cleaned.length === 11) {
      return '55' + cleaned;
    }

    // Se tem 10 dígitos (DDD + 8 dígitos), adiciona o 9 no lugar correto
    if (cleaned.length === 10) {
      // DDD é os primeiros 2 dígitos
      const ddd = cleaned.substring(0, 2);
      // O restante é o número de 8 dígitos
      const number = cleaned.substring(2);

      // Adiciona 55 (código do país) + DDD + '9' + número de 8 dígitos
      return '55' + ddd + '9' + number;
    }

    // Se o número de telefone já tiver o 9, com 9 dígitos, ele será tratado como 11 dígitos,
    // com o ddd e o 55 já inseridos, por isso não precisa de uma nova lógica

    return null; // Número inválido
  }

  validateContacts(contacts) {
    const valid = [];
    const invalid = [];

    contacts.forEach(contact => {
      if (this.isValidBrazilianNumber(contact.number)) {
        valid.push(contact);
      } else {
        invalid.push(contact);
      }
    });

    console.log(`✅ ${valid.length} números válidos`);
    console.log(`❌ ${invalid.length} números inválidos`);

    return {
      valid,
      invalid: invalid.length
    };
  }

  isValidBrazilianNumber(number) {
    if (!number || typeof number !== 'string') return false;

    // Garante que o número tem 13 dígitos
    if (number.length !== 13) return false;

    // Garante que começa com 55 (Brasil)
    if (!number.startsWith('55')) return false;

    // Garante que o 5º dígito é 9 (padrão de celular brasileiro)
    if (number.charAt(4) !== '9') return false;

    // Extrai o DDD
    const ddd = parseInt(number.substring(2, 4), 10);
    // Verifica se o DDD é válido (11-99)
    if (ddd < 11 || ddd > 99) return false;

    // Verifica se o DDD é um dos DDDs válidos do Brasil
    const validDDDs = [
      11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
      41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68,
      69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95,
      96, 97, 98, 99
    ];

    return validDDDs.includes(ddd);
  }

  generateSampleCSV() {
    const sample = `number
+5511999999999
+5521888888888
+5531777777777
+5541666666666`;
    
    return sample;
  }
}