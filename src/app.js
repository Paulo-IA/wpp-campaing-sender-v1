import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { WhatsAppService } from './services/whatsapp.js';
import { CSVService } from './services/csv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Criar pasta uploads se não existir
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
}

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do multer para uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// Instâncias dos serviços
const whatsappService = new WhatsAppService(io);
const csvService = new CSVService();

// Variáveis globais para armazenar dados da sessão
let uploadedCSV = null;
let uploadedImage = null;

// Rotas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.post('/upload-csv', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo CSV enviado' });
    }

    const contacts = await csvService.parseCSV(req.file.path);
    const validation = csvService.validateContacts(contacts);
    
    uploadedCSV = {
      path: req.file.path,
      contacts: validation.valid,
      totalContacts: contacts.length,
      validContacts: validation.valid.length,
      invalidContacts: validation.invalid
    };

    res.json({ 
      success: true, 
      message: `${validation.valid.length} números válidos de ${contacts.length} total`,
      validContacts: validation.valid.length,
      invalidContacts: validation.invalid,
      preview: validation.valid.slice(0, 5)
    });
  } catch (error) {
    console.error('Erro ao processar CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload-image', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada' });
    }

    uploadedImage = {
      path: req.file.path,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    };

    res.json({ 
      success: true, 
      message: 'Imagem carregada com sucesso',
      filename: req.file.filename,
      size: (req.file.size / 1024 / 1024).toFixed(2) + 'MB'
    });
  } catch (error) {
    console.error('Erro ao processar imagem:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/start-campaign', async (req, res) => {
  try {
    const { message } = req.body;

    if (!uploadedCSV) {
      return res.status(400).json({ error: 'CSV não carregado' });
    }

    if (!uploadedImage) {
      return res.status(400).json({ error: 'Imagem não carregada' });
    }

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Mensagem é obrigatória' });
    }

    if (!whatsappService.isConnected) {
      return res.status(400).json({ error: 'WhatsApp não está conectado' });
    }

    // Inicia a campanha
    await whatsappService.startBulkSend(uploadedCSV.contacts, uploadedImage.path, message.trim());
    
    res.json({ 
      success: true, 
      message: `Campanha iniciada para ${uploadedCSV.validContacts} contatos válidos` 
    });
  } catch (error) {
    console.error('Erro ao iniciar campanha:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/stop-campaign', async (req, res) => {
  try {
    whatsappService.stopBulkSend();
    res.json({ success: true, message: 'Campanha interrompida' });
  } catch (error) {
    console.error('Erro ao parar campanha:', error);
    res.status(500).json({ error: error.message });
  }
});

// Socket.IO eventos
io.on('connection', (socket) => {
  console.log(`🔌 Cliente conectado: ${socket.id}`);
  
  // Envia status atual do WhatsApp
  socket.emit('connection-status', { 
    status: whatsappService.isConnected ? 'connected' : 'disconnected' 
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 Cliente desconectado: ${socket.id}`);
  });
});

// Inicia o WhatsApp quando o servidor iniciar
whatsappService.initialize();

server.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Acesse http://localhost:${PORT} para usar a interface`);
  console.log(`📱 Aguardando conexão do WhatsApp...`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Encerrando servidor...');
  await whatsappService.disconnect();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Promise rejeitada:', error);
});