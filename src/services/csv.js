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
    
    // Remove + do início se houver
    if (phoneStr.toString().startsWith('+')) {
      // Já foi limpo acima, só precisa garantir que tem 13 dígitos
    }
    
    // Verifica se tem o formato correto (13 dígitos: 55 + DDD + número)
    if (cleaned.length === 13 && cleaned.startsWith('55')) {
      return cleaned;
    }
    
    // Se tem 11 dígitos (DDD + número), adiciona 55
    if (cleaned.length === 11) {
      return '55' + cleaned;
    }
    
    // Se tem 10 dígitos (DDD + número sem 9), adiciona 55 e 9
    if (cleaned.length === 10) {
      const ddd = cleaned.substring(0, 2);
      const number = cleaned.substring(2);
      return '55' + ddd + '9' + number;
    }
    
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
    
    // Deve ter exatamente 13 dígitos
    if (number.length !== 13) return false;
    
    // Deve começar com 55 (Brasil)
    if (!number.startsWith('55')) return false;
    
    // Extrai DDD (deve estar entre 11-99)
    const ddd = parseInt(number.substring(2, 4));
    if (ddd < 11 || ddd > 99) return false;
    
    // O 5º dígito deve ser 9 (celular)
    const fifthDigit = number.charAt(4);
    if (fifthDigit !== '9') return false;
    
    // Verifica DDDs válidos do Brasil
    const validDDDs = [
      11, 12, 13, 14, 15, 16, 17, 18, 19, // SP
      21, 22, 24, // RJ/ES
      27, 28, // ES
      31, 32, 33, 34, 35, 37, 38, // MG
      41, 42, 43, 44, 45, 46, // PR
      47, 48, 49, // SC
      51, 53, 54, 55, // RS
      61, // DF
      62, 64, // GO/TO
      63, // TO
      65, 66, // MT
      67, // MS
      68, // AC
      69, // RO
      71, 73, 74, 75, 77, // BA
      79, // SE
      81, 87, // PE
      82, // AL
      83, // PB
      84, // RN
      85, 88, // CE
      86, 89, // PI
      91, 93, 94, // PA
      92, 97, // AM
      95, // RR
      96, // AP
      98, 99  // MA
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