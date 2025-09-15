import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  isJidGroup 
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';

export class WhatsAppService {
  constructor(io) {
    this.io = io;
    this.sock = null;
    this.isConnected = false;
    this.isSending = false;
    this.currentCampaign = null;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async initialize() {
    try {
      console.log('🔄 Inicializando WhatsApp...');
      
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`📱 Usando Baileys v${version.join('.')}, latest: ${isLatest}`);

      const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

      this.sock = makeWASocket({
        version,
        auth: state,
        browser: ['WhatsApp Bulk Sender', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60_000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10_000,
        emitOwnEvents: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
      });

      this.setupEventHandlers(saveCreds);

    } catch (error) {
      console.error('❌ Erro ao inicializar WhatsApp:', error);
      this.io.emit('error', { message: 'Erro ao inicializar: ' + error.message });
      
      // Retry após 5 segundos
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`🔄 Tentativa ${this.retryCount}/${this.maxRetries} em 5s...`);
        setTimeout(() => this.initialize(), 5000);
      }
    }
  }

  setupEventHandlers(saveCreds) {
    // Salva credenciais quando atualizadas
    this.sock.ev.on('creds.update', saveCreds);

    // Monitora status da conexão
    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 QR Code gerado, aguardando scan...');
        try {
          const qrImage = await QRCode.toDataURL(qr);
          this.io.emit('qr-code', { qr: qrImage });
        } catch (error) {
          console.error('❌ Erro ao gerar QR:', error);
        }
      }

      if (connection === 'close') {
        this.isConnected = false;
        this.io.emit('connection-status', { status: 'disconnected' });
        
        const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

        if (lastDisconnect?.error instanceof Boom) {
          const reason = lastDisconnect.error.output.statusCode;
          console.log('❌ Conexão fechada:', DisconnectReason[reason] || reason);
          
          if (reason === DisconnectReason.loggedOut) {
            console.log('🚪 Usuário deslogado, necessário novo QR Code');
            this.io.emit('logged-out');
            return;
          }
        }

        if (shouldReconnect && this.retryCount < this.maxRetries) {
          this.retryCount++;
          console.log(`🔄 Reconectando... (${this.retryCount}/${this.maxRetries})`);
          setTimeout(() => this.initialize(), 3000);
        }
        
      } else if (connection === 'open') {
        console.log('✅ WhatsApp conectado com sucesso!');
        this.isConnected = true;
        this.retryCount = 0;
        this.io.emit('connection-status', { status: 'connected' });
        this.io.emit('qr-code', { qr: null });
      }
    });

    // Log de mensagens recebidas (opcional)
    this.sock.ev.on('messages.upsert', (m) => {
      // console.log('📨 Nova mensagem:', JSON.stringify(m, undefined, 2));
    });
  }

  async startBulkSend(contacts, imagePath, audioPath, message) {
    if (!this.isConnected) {
      throw new Error('WhatsApp não está conectado');
    }

    if (this.isSending) {
      throw new Error('Uma campanha já está em andamento');
    }

    this.isSending = true;
    this.currentCampaign = {
      contacts,
      imagePath,
      message,
      sent: 0,
      failed: 0,
      total: contacts.length,
      startTime: new Date()
    };

    console.log(`🚀 Iniciando campanha para ${contacts.length} contatos`);
    this.io.emit('campaign-started', {
      total: this.currentCampaign.total,
      startTime: this.currentCampaign.startTime
    });

    // Embaralha contatos para envio aleatório
    const shuffledContacts = this.shuffleArray([...contacts]);

    for (let i = 0; i < shuffledContacts.length && this.isSending; i++) {
      const contact = shuffledContacts[i];
      
      try {
        console.log(`📤 Enviando para: ${contact.number} (${i + 1}/${shuffledContacts.length})`);
        
        await this.sendMessage(contact, imagePath, audioPath, message);
        this.currentCampaign.sent++;
        
        this.io.emit('campaign-progress', {
          sent: this.currentCampaign.sent,
          failed: this.currentCampaign.failed,
          total: this.currentCampaign.total,
          current: contact.number,
          progress: Math.round((this.currentCampaign.sent + this.currentCampaign.failed) / this.currentCampaign.total * 100)
        });

        console.log(`✅ Enviado com sucesso para ${contact.number}`);

      } catch (error) {
        console.error(`❌ Falha ao enviar para ${contact.number}:`, error.message);
        this.currentCampaign.failed++;
        
        this.io.emit('campaign-progress', {
          sent: this.currentCampaign.sent,
          failed: this.currentCampaign.failed,
          total: this.currentCampaign.total,
          current: contact.number,
          error: error.message,
          progress: Math.round((this.currentCampaign.sent + this.currentCampaign.failed) / this.currentCampaign.total * 100)
        });
      }

      // Delay aleatório entre 30-60 segundos (exceto no último)
      if (i < shuffledContacts.length - 1 && this.isSending) {
        const delay = Math.floor(Math.random() * (60000 - 30000) + 30000);
        console.log(`⏳ Aguardando ${Math.round(delay/1000)}s antes do próximo envio...`);
        await this.sleep(delay);
      }
    }

    this.isSending = false;
    const endTime = new Date();
    const duration = Math.round((endTime - this.currentCampaign.startTime) / 1000);
    
    console.log('🏁 Campanha finalizada!');
    console.log(`📊 Enviados: ${this.currentCampaign.sent}, Falhas: ${this.currentCampaign.failed}`);
    console.log(`⏱️ Duração: ${Math.floor(duration / 60)}min ${duration % 60}s`);
    
    this.io.emit('campaign-finished', {
      sent: this.currentCampaign.sent,
      failed: this.currentCampaign.failed,
      total: this.currentCampaign.total,
      duration: duration
    });
  }

  async sendMessage(contact, imagePath, audioPath, message) {
    try {
      const phoneNumber = contact.number;
      const jid = phoneNumber + '@s.whatsapp.net';

      const [result] = await this.sock.onWhatsApp(jid);
      if (!result?.exists) {
        throw new Error(`Número não existe no WhatsApp`);
      }

      if (imagePath && fs.existsSync(imagePath)) {
        const imageBuffer = fs.readFileSync(imagePath);
        const extension = path.extname(imagePath).toLowerCase();
        
        let mimetype = 'image/jpeg';
        if (extension === '.png') mimetype = 'image/png';
        else if (extension === '.gif') mimetype = 'image/gif';
        else if (extension === '.webp') mimetype = 'image/webp';
        
        await this.sock.sendMessage(jid, {
          image: imageBuffer,
          caption: message,
          mimetype: mimetype
        });
      }

      if (audioPath && fs.existsSync(audioPath)) {
        const audioBuffer = fs.readFileSync(audioPath);
        await this.sock.sendMessage(jid, {
          audio: audioBuffer,
          mimetype: 'audio/mp4',
          ptt: true
        });
      }

      if (!imagePath && !audioPath && message && message.trim() !== '') {
        await this.sock.sendMessage(jid, {
          text: message
        });
      }

      return true;

    } catch (error) {
      throw new Error(`Falha no envio: ${error.message}`);
    }
  }

  stopBulkSend() {
    console.log('🛑 Parando campanha...');
    this.isSending = false;
    this.io.emit('campaign-stopped');
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async disconnect() {
    if (this.sock) {
      this.isSending = false;
      try {
        await this.sock.logout();
        console.log('📱 WhatsApp desconectado');
      } catch (error) {
        console.error('Erro ao desconectar:', error);
      }
    }
  }
}