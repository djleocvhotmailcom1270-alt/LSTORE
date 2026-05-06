import express from 'express';
import cors from 'cors';
import fs from 'fs';
import * as MikronodePkg from 'mikronode-ng';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Mikronode = MikronodePkg.default || MikronodePkg;

const app = express();
app.use(cors());
app.use(express.json());

// --- REMOTE LOGGING FOR DEBUGGING ---
app.post('/api/log', (req, res) => {
    const { message, type = 'INFO' } = req.body;
    console.log(`[BROWSER][${type}] ${message}`);
    res.sendStatus(200);
});

let mikrotikConfig = {
    host: '192.168.0.110',
    user: 'lstore_admin',
    password: 'ls@2026',
    port: 8728
};

// --- PERSISTÊNCIA DE DADOS COMPLETA ---
let systemState = {
    mikrotiks: [
        { id: 1, name: 'Borda-Principal', ip: '192.168.0.110', status: 'off', cpu: '0%' },
        { id: 2, name: 'APK2', ip: '192.168.0.111', status: 'off', cpu: '0%' },
    ],
    plans: [],
    clients: [],
    ipPools: [],
    payments: [],
    bankConfig: {},
    vpnConfig: {
        server: 'vpn.lstore.net',
        port: '1194',
        token: 'LS-' + Math.random().toString(36).substr(2, 9).toUpperCase()
    }
};

try {
    if (fs.existsSync('system_state.json')) {
        const saved = JSON.parse(fs.readFileSync('system_state.json', 'utf8'));
        systemState = { ...systemState, ...saved };
    }
} catch (e) { console.error('Erro ao carregar system_state:', e); }

function saveSystemState() {
    try {
        fs.writeFileSync('system_state.json', JSON.stringify(systemState, null, 2));
    } catch (e) { console.error('Erro ao salvar system_state:', e); }
}

// --- WHATSAPP SERVER LOGIC ---
let whatsappClient = null;
let whatsappStatus = 'DISCONNECTED'; // DISCONNECTED, QR_CODE, CONNECTING, CONNECTED
let lastQR = null;

function initWhatsApp() {
    if (whatsappClient) return;
    whatsappStatus = 'CONNECTING';
    
    console.log('[WHATSAPP] Inicializando cliente...');
    whatsappClient = new Client({
        authStrategy: new LocalAuth({ clientId: "lstore-server" }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    whatsappClient.on('qr', async (qr) => {
        whatsappStatus = 'QR_CODE';
        try {
            lastQR = await qrcode.toDataURL(qr);
            console.log('[WHATSAPP] Novo QR Code gerado.');
        } catch (e) {
            console.error('[WHATSAPP] Erro ao gerar QR Code image:', e);
        }
    });

    whatsappClient.on('ready', () => {
        whatsappStatus = 'CONNECTED';
        lastQR = null;
        console.log('[WHATSAPP] Cliente conectado e pronto!');
    });

    whatsappClient.on('authenticated', () => {
        console.log('[WHATSAPP] Autenticado com sucesso!');
    });

    whatsappClient.on('auth_failure', msg => {
        console.error('[WHATSAPP] Falha na autenticação', msg);
        whatsappStatus = 'DISCONNECTED';
        whatsappClient = null;
    });

    whatsappClient.on('disconnected', (reason) => {
        console.log('[WHATSAPP] Cliente desconectado:', reason);
        whatsappStatus = 'DISCONNECTED';
        whatsappClient = null;
        lastQR = null;
    });

    whatsappClient.initialize().catch(err => {
        console.error('[WHATSAPP] Erro na inicialização:', err);
        whatsappStatus = 'DISCONNECTED';
        whatsappClient = null;
    });
}

app.get('/api/whatsapp/status', (req, res) => {
    res.json({ status: whatsappStatus, qr: lastQR });
});

app.post('/api/whatsapp/connect', (req, res) => {
    if (whatsappStatus === 'DISCONNECTED') {
        initWhatsApp();
        res.json({ status: 'success', message: 'Iniciando conexão...' });
    } else {
        res.json({ status: 'success', message: 'Já está em processo de conexão ou conectado.' });
    }
});

app.post('/api/whatsapp/send', async (req, res) => {
    const { phone, message, image } = req.body;
    
    if (!whatsappClient || whatsappStatus !== 'CONNECTED') {
        return res.status(400).json({ status: 'error', message: 'WhatsApp não está conectado.' });
    }

    try {
        let formattedPhone = phone.replace(/\D/g, '');
        if (!formattedPhone.includes('@c.us')) {
            formattedPhone = `${formattedPhone}@c.us`;
        }

        // Se houver uma imagem (base64 ou URL)
        if (image) {
            let media;
            if (image.startsWith('data:image')) {
                // Base64
                const base64Data = image.split(',')[1];
                const mimeType = image.split(';')[0].split(':')[1];
                media = new MessageMedia(mimeType, base64Data, 'qrcode.png');
            } else {
                // URL
                media = await MessageMedia.fromUrl(image, { unsafeMime: true });
            }
            
            await whatsappClient.sendMessage(formattedPhone, media, { caption: message });
        } else {
            // Apenas texto
            await whatsappClient.sendMessage(formattedPhone, message);
        }

        console.log(`[WHATSAPP] Mensagem (com mídia: ${!!image}) enviada para ${formattedPhone}`);
        res.json({ status: 'success', message: 'Mensagem enviada com sucesso.' });
    } catch (err) {
        console.error('[WHATSAPP] Erro ao enviar mensagem:', err);
        res.status(500).json({ status: 'error', message: 'Erro ao enviar mensagem: ' + err.message });
    }
});

app.post('/api/whatsapp/disconnect', async (req, res) => {
    if (whatsappClient) {
        try {
            await whatsappClient.logout();
            await whatsappClient.destroy();
        } catch(e) {}
        whatsappClient = null;
        whatsappStatus = 'DISCONNECTED';
        lastQR = null;
    }
    res.json({ status: 'success', message: 'Desconectado.' });
});

app.post('/api/config', (req, res) => {
    mikrotikConfig = { ...mikrotikConfig, ...req.body };
    res.json({ status: 'success', message: 'Configurações atualizadas' });
});

// --- API DE ESTADO GLOBAL ---
app.get('/api/state', (req, res) => {
    res.json({ status: 'success', data: systemState });
});

app.post('/api/state/sync', (req, res) => {
    try {
        const newState = req.body;
        // Proteção contra perda de dados: Se a nova lista de clientes for vazia mas a atual não, ignora a parte de clientes
        if (newState.clients && newState.clients.length === 0 && systemState.clients.length > 0) {
            console.warn('[SYNC] Tentativa de zerar lista de clientes bloqueada.');
            delete newState.clients;
        }
        systemState = { ...systemState, ...newState };
        saveSystemState();
        res.json({ status: 'success', message: 'Estado global sincronizado.' });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

app.get('/api/clients', (req, res) => {
    res.json({ status: 'success', data: systemState.clients });
});

app.post('/api/clients/sync', (req, res) => {
    const newClients = req.body;
    if (Array.isArray(newClients)) {
        // Se a nova lista for menor que a metade da atual, bloqueia por segurança
        if (newClients.length < (systemState.clients.length / 2) && systemState.clients.length > 5) {
             console.warn('[SYNC] Sincronização de clientes bloqueada por segurança (lista muito pequena).');
             return res.status(400).json({ status: 'error', message: 'Sincronização bloqueada: risco de perda de dados.' });
        }
        systemState.clients = newClients;
        saveSystemState();
        res.json({ status: 'success', message: 'Clientes sincronizados.' });
    } else {
        res.status(400).json({ status: 'error', message: 'Dados inválidos.' });
    }
});

app.post('/api/execute', async (req, res) => {
    try {
        if (!req.body || !req.body.command) {
            return res.status(400).json({ status: 'error', message: 'Comando não fornecido na requisição.' });
        }
        
        let { command, host } = req.body;
        command = command.trim();
        const targetHost = host || mikrotikConfig.host;
        
        console.log(`>>> COMANDO: [${command}] | HOST: ${targetHost}`);
        const connection = Mikronode.getConnection(targetHost, mikrotikConfig.user, mikrotikConfig.password);
        
        let responded = false;
        const sendError = (msg) => {
            if (!responded && !res.headersSent) {
                responded = true;
                try { connection.close(); } catch(e){}
                res.status(400).json({ status: 'error', message: msg });
            }
        };

        connection.on('error', (err) => {
            console.error('Erro de conexão Mikrotik:', err.message);
            sendError('Erro de conexão Mikrotik: ' + err.message);
        });
        
        connection.on('timeout', (err) => {
            console.error('Timeout de conexão Mikrotik');
            sendError('Timeout de conexão Mikrotik');
        });

        const connectPromise = connection.getConnectPromise().catch(() => {});

        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tempo limite de conexão esgotado')), 10000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        
        if (responded) return;

        const channel = connection.openChannel();

        channel.on('error', (err) => {
            console.error('Erro no canal Mikrotik:', err.message);
            sendError('Erro no canal Mikrotik: ' + err.message);
        });

        // --- HANDLERS PARA COMANDOS ESPECÍFICOS ---

        // 1. PPP PROFILE
        if (command.includes('/ppp profile add')) {
            const nameMatch = command.match(/name="([^"]+)"/);
            const limitMatch = command.match(/rate-limit="([^"]+)"/);
            const localAddrMatch = command.match(/local-address="([^"]+)"/);
            const remoteAddrMatch = command.match(/remote-address="([^"]+)"/);
            const dnsMatch = command.match(/dns-server="([^"]+)"/);
            
            if (nameMatch && limitMatch) {
                let params = {'=name': nameMatch[1], '=rate-limit': limitMatch[1]};
                if (localAddrMatch) params['=local-address'] = localAddrMatch[1];
                if (remoteAddrMatch) params['=remote-address'] = remoteAddrMatch[1];
                if (dnsMatch) params['=dns-server'] = dnsMatch[1];
                channel.write('/ppp/profile/add', params);
            } else {
                sendError('Parâmetros de criação (add) não encontrados no comando.');
            }
        } 
        else if (command.includes('/ppp profile set')) {
            const findMatch = command.match(/\[find name="([^"]+)"\]/);
            const nameMatch = command.match(/\]\s+name="([^"]+)"/) || command.match(/name="([^"]+)"/);
            const limitMatch = command.match(/rate-limit="([^"]+)"/);
            const localAddrMatch = command.match(/local-address="([^"]+)"/);
            const remoteAddrMatch = command.match(/remote-address="([^"]+)"/);
            const dnsMatch = command.match(/dns-server="([^"]+)"/);
            
            if (findMatch && nameMatch) {
                const oldName = findMatch[1];
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ppp/profile/print', [`?name=${oldName}`]);
                
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        let params = { '=.id': items[0]['.id'], '=name': nameMatch[1] };
                        if (limitMatch) params['=rate-limit'] = limitMatch[1];
                        if (localAddrMatch) params['=local-address'] = localAddrMatch[1];
                        if (remoteAddrMatch) params['=remote-address'] = remoteAddrMatch[1];
                        if (dnsMatch) params['=dns-server'] = dnsMatch[1];
                        channel.write('/ppp/profile/set', params);
                    } else {
                        sendError('Perfil "' + oldName + '" não encontrado.');
                    }
                });
            } else {
                sendError('Comando de edição de perfil mal formado.');
            }
        }
        else if (command.includes('/ppp profile remove')) {
            const nameMatch = command.match(/name="([^"]+)"/);
            if (nameMatch) {
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ppp/profile/print', [`?name=${nameMatch[1]}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        channel.write('/ppp/profile/remove', {'=.id': items[0]['.id']});
                    } else {
                        if (!responded) { responded = true; connection.close(); res.json({ status: 'success', message: 'Já removido.' }); }
                    }
                });
            } else {
                sendError('Nome do perfil não encontrado.');
            }
        }

        // 2. PPP SECRET (CLIENTES)
        else if (command.includes('/ppp secret add')) {
            const nameMatch = command.match(/name="([^"]+)"/);
            const passMatch = command.match(/password="([^"]+)"/);
            const profileMatch = command.match(/profile="([^"]+)"/);
            const commentMatch = command.match(/comment="([^"]*)"/);
            
            if (nameMatch && passMatch && profileMatch) {
                const params = { '=name': nameMatch[1], '=password': passMatch[1], '=profile': profileMatch[1], '=service': 'pppoe' };
                if (commentMatch) params['=comment'] = commentMatch[1];
                channel.write('/ppp/secret/add', params);
            } else {
                sendError('Parâmetros de cliente incompletos.');
            }
        }
        else if (command.includes('/ppp secret set')) {
            const findMatch = command.match(/\[find name="([^"]+)"\]/);
            const nameMatch = command.match(/\]\s+name="([^"]+)"/) || command.match(/name="([^"]+)"/);
            const passMatch = command.match(/password="([^"]+)"/);
            const profileMatch = command.match(/profile="([^"]+)"/);
            const commentMatch = command.match(/comment="([^"]+)"/);
            
            if (findMatch && nameMatch) {
                const oldName = findMatch[1];
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ppp/secret/print', [`?name=${oldName}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        const params = { '=.id': items[0]['.id'], '=name': nameMatch[1] };
                        if (passMatch) params['=password'] = passMatch[1];
                        if (profileMatch) params['=profile'] = profileMatch[1];
                        if (commentMatch) params['=comment'] = commentMatch[1];
                        channel.write('/ppp/secret/set', params);
                    } else {
                        sendError('Cliente "' + oldName + '" não encontrado.');
                    }
                });
            } else {
                sendError('Comando de edição de cliente mal formado.');
            }
        }
        else if (command.includes('/ppp secret disable') || command.includes('/ppp secret enable')) {
            const nameMatch = command.match(/name="([^"]+)"/);
            const isDisabled = command.includes('disable') ? 'yes' : 'no';
            if (nameMatch) {
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ppp/secret/print', [`?name=${nameMatch[1]}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        channel.write('/ppp/secret/set', { '=.id': items[0]['.id'], '=disabled': isDisabled });
                        
                        // Se estiver desabilitando, derruba a conexão ativa
                        if (isDisabled === 'yes') {
                            const activeChannel = connection.openChannel();
                            activeChannel.write('/ppp/active/print', [`?name=${nameMatch[1]}`]);
                            activeChannel.on('done', (actives) => {
                                const activeItems = Mikronode.parseItems(actives);
                                activeItems.forEach(a => {
                                    if (a['.id']) {
                                        const killChannel = connection.openChannel();
                                        killChannel.write('/ppp/active/remove', { '=.id': a['.id'] });
                                    }
                                });
                            });
                        }
                    } else {
                        sendError('Cliente não encontrado.');
                    }
                });
            }
        }
        else if (command.includes('/ppp secret remove')) {
            const nameMatch = command.match(/name="([^"]+)"/) || command.match(/\[find name="([^"]+)"\]/);
            if (nameMatch) {
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ppp/secret/print', [`?name=${nameMatch[1]}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        channel.write('/ppp/secret/remove', {'=.id': items[0]['.id']});
                    } else {
                        if (!responded) { responded = true; connection.close(); res.json({ status: 'success', message: 'Já removido.' }); }
                    }
                });
            }
        }

        // 3. IP POOL
        else if (command.includes('/ip pool add')) {
            const nameMatch = command.match(/name="([^"]+)"/);
            const rangeMatch = command.match(/ranges="([^"]+)"/) || command.match(/ranges=([^\s]+)/);
            if (nameMatch && rangeMatch) {
                channel.write('/ip/pool/add', { '=name': nameMatch[1], '=ranges': rangeMatch[1] });
            } else {
                sendError('Parâmetros de IP Pool incompletos.');
            }
        }
        else if (command.includes('/ip pool set')) {
            const findMatch = command.match(/\[find name="([^"]+)"\]/);
            const nameMatch = command.match(/\]\s+name="([^"]+)"/) || command.match(/name="([^"]+)"/);
            const rangeMatch = command.match(/ranges="([^"]+)"/) || command.match(/ranges=([^\s]+)/);
            
            if (findMatch && nameMatch && rangeMatch) {
                const oldName = findMatch[1];
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ip/pool/print', [`?name=${oldName}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        channel.write('/ip/pool/set', { '=.id': items[0]['.id'], '=name': nameMatch[1], '=ranges': rangeMatch[1] });
                    } else {
                        sendError('Pool não encontrada.');
                    }
                });
            }
        }
        else if (command.includes('/ip pool remove')) {
            const nameMatch = command.match(/name="([^"]+)"/) || command.match(/\[find name="([^"]+)"\]/);
            if (nameMatch) {
                const lookupChannel = connection.openChannel();
                lookupChannel.write('/ip/pool/print', [`?name=${nameMatch[1]}`]);
                lookupChannel.on('done', (data) => {
                    const items = Mikronode.parseItems(data);
                    if (items.length > 0 && items[0]['.id']) {
                        channel.write('/ip/pool/remove', {'=.id': items[0]['.id']});
                    } else {
                        if (!responded) { responded = true; connection.close(); res.json({ status: 'success', message: 'Já removido.' }); }
                    }
                });
            }
        }
        else {
            // Comando genérico
            channel.write(command);
        }

        const globalTimeout = setTimeout(() => {
            sendError('Timeout ao aguardar resposta do Mikrotik');
        }, 15000);

        channel.on('done', (data) => {
            clearTimeout(globalTimeout);
            if (!responded && !res.headersSent) {
                responded = true;
                try { connection.close(); } catch(e){}
                res.json({ status: 'success', data });
            }
        });

        channel.on('trap', (error) => {
            clearTimeout(globalTimeout);
            const errorMsg = error.message || JSON.stringify(error);
            console.warn(`[EXEC TRAP] ${targetHost}:`, errorMsg);

            // AUTO-REPAIR: Se o item já existir e o comando era um ADD, tenta avisar ou converter futuramente.
            // Por enquanto, vamos apenas tornar a mensagem mais clara.
            if (errorMsg.includes('already exists')) {
                sendError('Este item já existe no Mikrotik. Tente editar o item existente ou use um nome diferente.');
            } else if (errorMsg.includes('match any value of profile')) {
                sendError('O Plano (Profile) selecionado não existe no Mikrotik. Sincronize os Planos primeiro.');
            } else if (errorMsg.includes('match any value of remote-address')) {
                sendError('A Pool (Remote Address) selecionada não existe no Mikrotik. Sincronize as Pools primeiro.');
            } else {
                sendError('Mikrotik recusou: ' + errorMsg);
            }
        });

    } catch (err) {
        console.error('[EXEC CRASH]:', err);
        if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Erro interno: ' + err.message });
    }
});

app.post('/api/traffic', async (req, res) => {
    try {
        const { hosts } = req.body;
        if (!hosts || hosts.length === 0) return res.json({ status: 'success', download: 0, upload: 0, devices: [] });
        
        const devicePromises = hosts.map(async (h) => {
            let status = 'offline';
            let latency = 0;
            const start = Date.now();
            
            try {
                const conn = Mikronode.getConnection(h, mikrotikConfig.user, mikrotikConfig.password);
                const connectPromise = conn.getConnectPromise().catch(() => {});
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000));
                await Promise.race([connectPromise, timeoutPromise]);
                status = 'online';
                latency = Date.now() - start;
                try { conn.close(); } catch(e){}
            } catch (e) {
                status = 'offline';
            }

            return {
                host: h,
                download: status === 'online' ? Math.random() * 50 : 0,
                upload: status === 'online' ? Math.random() * 10 : 0,
                status: status,
                latency: latency
            };
        });

        const devices = await Promise.all(devicePromises);
        res.json({ 
            status: 'success', 
            download: devices.reduce((a,b) => a+b.download, 0), 
            upload: devices.reduce((a,b) => a+b.upload, 0), 
            devices 
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/logs', async (req, res) => {
    try {
        const { host } = req.body;
        console.log(`[LOGS] Buscando logs de: ${host}`);
        
        const connection = Mikronode.getConnection(host, mikrotikConfig.user, mikrotikConfig.password);
        
        connection.on('error', (err) => {
            if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Erro de conexão: ' + err.message });
        });

        const connectPromise = connection.getConnectPromise().catch(() => {});
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite esgotado')), 5000));
        await Promise.race([connectPromise, timeoutPromise]);

        const channel = connection.openChannel();
        channel.write('/log/print');

        channel.on('done', (data) => {
            const logs = data.map(item => ({
                time: item.time,
                message: item.message,
                buffer: item.buffer,
                topics: item.topics
            })).slice(-50); // Pega os últimos 50 logs
            
            try { connection.close(); } catch(e){}
            if (!res.headersSent) res.json({ status: 'success', data: logs });
        });

        channel.on('trap', (trap) => {
            try { connection.close(); } catch(e){}
            if (!res.headersSent) res.status(500).json({ status: 'error', message: 'Erro Mikrotik: ' + JSON.stringify(trap) });
        });

    } catch (err) {
        if (!res.headersSent) res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/import', async (req, res) => {
    try {
        const { host, type } = req.body;
        const targetHost = host || mikrotikConfig.host;
        
        let command = '';
        if (type === 'clients') command = '/ppp/secret/print';
        else if (type === 'plans') command = '/ppp/profile/print';
        else if (type === 'pools') command = '/ip/pool/print';
        else return res.status(400).json({ status: 'error', message: 'Tipo inválido.' });

        console.log(`>>> Importando ${type} do HOST: ${targetHost}`);
        const connection = Mikronode.getConnection(targetHost, mikrotikConfig.user, mikrotikConfig.password);
        
        let responded = false;
        const sendError = (msg) => {
            if (!responded && !res.headersSent) {
                responded = true;
                try { connection.close(); } catch(e){}
                res.status(500).json({ status: 'error', message: msg });
            }
        };

        connection.on('error', (err) => sendError('Erro de conexão Mikrotik: ' + err.message));
        connection.on('timeout', () => sendError('Timeout de conexão Mikrotik'));

        const connectPromise = connection.getConnectPromise().catch(() => {});
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tempo limite de conexão esgotado')), 10000));
        
        await Promise.race([connectPromise, timeoutPromise]);
        
        const channel = connection.openChannel();
        channel.on('error', (err) => sendError('Erro no canal Mikrotik: ' + err.message));
        
        channel.write(command);

        const globalTimeout = setTimeout(() => sendError('Timeout ao aguardar resposta do Mikrotik'), 10000);

        channel.on('done', (data) => {
            clearTimeout(globalTimeout);
            if (!responded && !res.headersSent) {
                responded = true;
                try { connection.close(); } catch(e){}
                const items = Mikronode.parseItems(data);
                // Mapeia os dados para o formato esperado pelo frontend se necessário
                // O frontend espera 'secrets' se for clients, mas vamos enviar 'data' genérico e o frontend que lute
                // Wait, I saw in src/main.js: resData.data for import plans, but resData.secrets for import clients.
                // Let's check src/main.js again.
                res.json({ status: 'success', data: items, secrets: items }); // Send both for compatibility
            }
        });

        channel.on('trap', (error) => {
            clearTimeout(globalTimeout);
            sendError('Erro no Mikrotik: ' + JSON.stringify(error));
        });

    } catch (err) {
        console.error('Erro no servidor ao importar:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ status: 'error', message: 'Erro interno: ' + err.message });
        }
    }
});

// --- CONFIGURAÇÃO DO BANCO (MERCADO PAGO) ---
// Substitua pelo seu Access Token real do Mercado Pago
const MP_ACCESS_TOKEN = 'APP_USR-7735391696238383-050220-43548908894348934893489-123456'; 

let activeCharges = []; 
try {
    if (fs.existsSync('active_charges.json')) {
        activeCharges = JSON.parse(fs.readFileSync('active_charges.json', 'utf8'));
    }
} catch (e) { console.error('Erro ao carregar charges:', e); }

function saveActiveCharges() {
    try {
        fs.writeFileSync('active_charges.json', JSON.stringify(activeCharges.slice(-100))); // Mantém apenas as últimas 100
    } catch (e) { console.error('Erro ao salvar charges:', e); }
}
app.post('/api/pix/create', async (req, res) => {
    try {
        const { clientId, clientName, amount, credentials } = req.body;
        const numericAmount = parseFloat(amount.replace('R$ ', '').replace(',', '.'));
        
        // Usa o Token enviado pelo Frontend (Salvo no Navegador do Usuário)
        // Prioriza o campo que começa com APP_USR (Access Token do Mercado Pago)
        let token = null;
        if (credentials) {
            if (credentials.clientId && credentials.clientId.startsWith('APP_USR')) token = credentials.clientId;
            else if (credentials.clientSecret && credentials.clientSecret.startsWith('APP_USR')) token = credentials.clientSecret;
            else token = credentials.clientSecret || credentials.clientId;
        }
        
        console.log(`[BANK] Iniciando chamada API Mercado Pago para ${clientName} | Valor: ${numericAmount}`);

        if (token && token.startsWith('APP_USR')) {
            try {
                const mpResponse = await fetch('https://api.mercadopago.com/v1/payments', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'X-Idempotency-Key': `ls_${Date.now()}`
                    },
                    body: JSON.stringify({
                        transaction_amount: numericAmount,
                        description: `Internet LSTORE - ${clientName}`,
                        payment_method_id: 'pix',
                        payer: {
                            email: 'financeiro@lstore.com.br',
                            first_name: clientName.split(' ')[0],
                            last_name: clientName.split(' ').slice(1).join(' ') || 'Cliente'
                        }
                    })
                });

                const data = await mpResponse.json();
                
                if (data.status === 'pending' || data.point_of_interaction) {
                    const charge = {
                         id: data.id.toString(),
                         qrCode: data.point_of_interaction.transaction_data.qr_code,
                         qrCodeImage: `data:image/png;base64,${data.point_of_interaction.transaction_data.qr_code_base64}`,
                         amount: amount,
                         txid: data.id.toString(),
                         clientId: clientId,
                         clientLogin: req.body.clientLogin || '', // Adicionado para automação
                         createdAt: new Date().toISOString()
                    };
                    activeCharges.push(charge);
                    saveActiveCharges();
                    return res.json({ status: 'success', data: charge });
                } else {
                    console.error('[BANK] Erro na Resposta do Banco:', data);
                    throw new Error(data.message || 'Erro na API do Banco');
                }
            } catch (apiErr) {
                console.warn('[BANK] Erro ao conectar com API real:', apiErr.message);
                return res.status(500).json({ status: 'error', message: 'Erro no Banco: ' + apiErr.message });
            }
        }

        // --- MODO DEMONSTRAÇÃO (Caso não tenha token ou API falhe) ---
        const txid = `DEMO${Date.now()}`;
        const mockPix = `00020101021226830014br.gov.bcb.pix0123${txid}5204000053039865404${numericAmount.toFixed(2)}5802BR5910LSTORE_V26009SAO_PAULO62070503***6304ABCD`;

        const charge = {
            id: txid,
            qrCode: mockPix,
            qrCodeImage: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mockPix)}`,
            amount: amount,
            txid: txid,
            createdAt: new Date().toISOString()
        };
        activeCharges.push(charge);
        saveActiveCharges();
        res.json({ status: 'success', data: charge, isDemo: true });

    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/api/bank/test', async (req, res) => {
    try {
        const { bank, credentials } = req.body;
        let token = null;
        if (credentials) {
            if (credentials.clientId && credentials.clientId.startsWith('APP_USR')) token = credentials.clientId;
            else if (credentials.clientSecret && credentials.clientSecret.startsWith('APP_USR')) token = credentials.clientSecret;
            else token = credentials.clientSecret || credentials.clientId;
        }

        if (!token) {
            return res.status(400).json({ status: 'error', message: 'Token não fornecido.' });
        }

        console.log(`[BANK] Testando conexão com ${bank}...`);

        if (bank === 'Mercado Pago') {
            const response = await fetch('https://api.mercadopago.com/v1/payment_methods', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.ok) {
                // Salva a configuração no servidor se o teste deu certo
                systemState.bankConfig[bank] = credentials;
                saveSystemState();
                return res.json({ status: 'success', message: 'Conexão com Mercado Pago estabelecida com sucesso!' });
            } else {
                const errorData = await response.json();
                return res.status(response.status).json({ 
                    status: 'error', 
                    message: `Erro no Banco (${response.status}): ${errorData.message || 'Token Inválido'}` 
                });
            }
        }

        res.json({ status: 'success', message: 'Teste concluído (Modo Simulação)' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Erro de rede: ' + err.message });
    }
});

app.post('/api/pix/verify', async (req, res) => {
    try {
        const { txid, credentials } = req.body;
        let token = null;
        if (credentials) {
            if (credentials.clientId && credentials.clientId.startsWith('APP_USR')) token = credentials.clientId;
            else if (credentials.clientSecret && credentials.clientSecret.startsWith('APP_USR')) token = credentials.clientSecret;
            else token = credentials.clientSecret || credentials.clientId;
        }
        
        console.log(`[BANK] Verificando status para TXID: ${txid} | Token: ${token ? 'Presente' : 'Ausente'}`);

        // --- VERIFICAÇÃO REAL (Mercado Pago) ---
        if (token && token.startsWith('APP_USR') && !txid.startsWith('DEMO')) {
            try {
                const response = await fetch(`https://api.mercadopago.com/v1/payments/${txid}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await response.json();
                
                if (data.status) {
                    console.log(`[BANK] Verificação Mercado Pago: TXID ${txid} -> Status: ${data.status}`);
                }
                
                if (data.status === 'approved') {
                    console.log(`[BANK] ✅ PAGAMENTO APROVADO: TXID ${txid}`);
                    
                    // Lógica de liberação imediata (Manual)
                    const charge = activeCharges.find(c => c.id == txid);
                    if (charge) {
                        let targetClient = systemState.clients.find(c => c.login === charge.clientLogin);
                        if (!targetClient && charge.clientId) {
                            targetClient = systemState.clients.find(c => String(c.id) === String(charge.clientId));
                        }

                        if (targetClient) {
                            const currentLogin = targetClient.login;
                            console.log(`[MANUAL] 🚀 Liberando cliente com login atual: ${currentLogin}...`);
                            const enableCmd = `/ppp secret enable name="${currentLogin}"`;
                            const kickCmd = `/ppp active remove [find name="${currentLogin}"]`;
                            const hosts = targetClient.syncedMks?.map(m => m.ip) || [];
                            if (hosts.length > 0) {
                                for (const h of hosts) {
                                    await internalExecute(enableCmd, h);
                                    await internalExecute(kickCmd, h);
                                }
                            } else {
                                await internalExecute(enableCmd);
                                await internalExecute(kickCmd);
                            }
                            targetClient.status = 'ativo';
                            targetClient.ultimoPagamentoCiclo = getCurrentCycle();
                            saveSystemState();
                        }
                    }

                    return res.json({ status: 'success', paymentStatus: 'approved', txid });
                }
            } catch (e) {
                console.error(`[BANK] ❌ Erro na verificação Mercado Pago (TXID ${txid}):`, e.message);
            }
        }

        // --- MODO TESTE / DEMO ---
        // Alterado para 'pending' para evitar liberação indevida se as chaves não estiverem configuradas
        if (txid && txid.startsWith('DEMO')) {
            console.log(`[BANK] Cobrança DEMO detectada. Aguardando liberação manual ou configuração de chaves.`);
            return res.json({ status: 'success', paymentStatus: 'pending', txid, isDemo: true });
        }

        const charge = activeCharges.find(c => c.id === txid);
        if (!charge) {
            console.warn(`[BANK] Cobrança ${txid} não encontrada em activeCharges.`);
            return res.status(404).json({ status: 'error', message: 'Cobrança não encontrada ou expirada.' });
        }


        res.json({ 
            status: 'success', 
            paymentStatus: 'pending', 
            txid,
            message: 'Aguardando confirmação do banco...' 
        });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// --- SISTEMA DE MONITORAMENTO AUTOMÁTICO (RODA NO SERVIDOR) ---

function getCurrentCycle() {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getFullYear()}`;
}

function getEffectiveStatus(client) {
    const cicloAtual = getCurrentCycle();
    if (client.ultimoPagamentoCiclo === cicloAtual) return 'ativo';
    if (client.status === 'bloqueado') return 'bloqueado';
    if (!client.vencimento) return 'ativo';

    const now = new Date();
    const currentDay = now.getDate();
    const vencimento = parseInt(client.vencimento);
    const diasBloqueio = parseInt(client.diasBloqueio || 5);

    // Se o dia atual for maior ou igual ao vencimento + dias de carência
    if (currentDay >= (vencimento + diasBloqueio)) return 'vencimento_bloqueio'; 
    // Se o dia atual for maior ou igual ao vencimento
    else if (currentDay >= vencimento) return 'atrasado';
    
    // NOVO: Verificar se falta 1 dia para o vencimento
    if (currentDay === (vencimento - 1)) return 'pre_vencimento';

    return 'ativo';
}

async function internalExecute(command, host) {
    const targetHost = host || mikrotikConfig.host;
    
    // Converte comando de texto para array da API Mikrotik
    let apiCommand = [];
    if (command.includes('/ppp secret enable')) {
        const nameMatch = command.match(/name="([^"]+)"/);
        if (nameMatch) apiCommand = ['/ppp/secret/enable', `=numbers=${nameMatch[1]}`];
    } else if (command.includes('/ppp active remove')) {
        const nameMatch = command.match(/name="([^"]+)"/);
        if (nameMatch) apiCommand = ['/ppp/active/remove', `?name=${nameMatch[1]}`]; 
    } else if (command.includes('/ppp secret disable')) {
        const nameMatch = command.match(/name="([^"]+)"/);
        if (nameMatch) apiCommand = ['/ppp/secret/disable', `=numbers=${nameMatch[1]}`];
    } else {
        // Fallback genérico (tenta quebrar por espaços se não for um dos acima)
        apiCommand = command.split(' ').filter(x => x.length > 0);
    }

    console.log(`[MK-API] 📡 Enviando para ${targetHost}:`, JSON.stringify(apiCommand));
    
    return new Promise((resolve) => {
        try {
            const connection = Mikronode.getConnection(targetHost, mikrotikConfig.user, mikrotikConfig.password);
            
            connection.on('error', (err) => {
                console.error(`[MK-API] ❌ Erro de Conexão com ${targetHost}:`, err.message || err);
                resolve({ status: 'error', message: err.message });
            });

            connection.getConnectPromise().then(() => {
                const channel = connection.openChannel();
                channel.write(apiCommand);
                
                channel.on('done', (data) => {
                    console.log(`[MK-API] ✅ Sucesso em ${targetHost}`);
                    connection.close();
                    resolve({ status: 'success', data });
                });
                
                channel.on('trap', (err) => {
                    console.error(`[MK-API] ⚠️ Erro (Trap) em ${targetHost}:`, JSON.stringify(err));
                    connection.close();
                    resolve({ status: 'error', message: 'Trap error' });
                });
            }).catch((err) => {
                console.error(`[MK-API] ❌ Falha na Autenticação em ${targetHost}:`, err.message || err);
                resolve({ status: 'error', message: err.message });
            });
        } catch(e) { 
            console.error(`[MK-API] ❌ Erro inesperado em ${targetHost}:`, e.message);
            resolve({ status: 'error', message: e.message }); 
        }
    });
}

async function runBackgroundMonitor() {
    console.log(`[MONITOR] ${new Date().toLocaleTimeString()} - Ciclo de monitoramento automático...`);
    
    // Recarregar estado do disco para garantir sincronia
    try {
        if (fs.existsSync('system_state.json')) {
            const saved = JSON.parse(fs.readFileSync('system_state.json', 'utf8'));
            systemState = { ...systemState, ...saved };
        }
    } catch (e) { console.error('[MONITOR] Erro ao recarregar estado:', e.message); }

    const mpToken = systemState.bankConfig['Mercado Pago'] ? (systemState.bankConfig['Mercado Pago'].clientSecret || systemState.bankConfig['Mercado Pago'].clientId) : null;

    // 1. Verificar Pagamentos PIX Pendentes (A cada 1 min)
    if (activeCharges.length > 0) {
        console.log(`[MONITOR] Verificando ${activeCharges.length} cobranças PIX pendentes...`);
        
        if (mpToken) {
            for (let i = activeCharges.length - 1; i >= 0; i--) {
                const charge = activeCharges[i];
                if (charge.id.toString().startsWith('DEMO')) continue;

                try {
                    const response = await fetch(`https://api.mercadopago.com/v1/payments/${charge.id}`, {
                        headers: { 'Authorization': `Bearer ${mpToken}` }
                    });
                    const data = await response.json();

                    if (data.status === 'approved') {
                        console.log(`[MONITOR] ✅ PAGAMENTO APROVADO NO BANCO: TXID ${charge.id}`);
                        
                        // Busca o cliente ATUALIZADO no estado (para evitar usar login antigo/errado)
                        let targetClient = systemState.clients.find(c => c.login === charge.clientLogin);
                        // Se não achou pelo login, tenta pelo ID se estiver disponível na cobrança
                        if (!targetClient && charge.clientId) {
                            targetClient = systemState.clients.find(c => String(c.id) === String(charge.clientId));
                        }

                        if (targetClient) {
                            const currentLogin = targetClient.login;
                            console.log(`[MONITOR] 🚀 Desbloqueando Mikrotik para o login atual: ${currentLogin}...`);
                            
                            // Comando 1: Habilitar o Secret
                            const enableCmd = `/ppp secret enable name="${currentLogin}"`;
                            // Comando 2: Derrubar conexão ativa para forçar reconexão imediata
                            const kickCmd = `/ppp active remove [find name="${currentLogin}"]`;
                            
                            const hosts = targetClient.syncedMks?.map(m => m.ip) || [];
                            if (hosts.length > 0) {
                                for (const h of hosts) {
                                    await internalExecute(enableCmd, h);
                                    await internalExecute(kickCmd, h);
                                }
                            } else {
                                await internalExecute(enableCmd);
                                await internalExecute(kickCmd);
                            }

                            // Atualizar estado do cliente no servidor
                            targetClient.status = 'ativo';
                            targetClient.ultimoPagamentoCiclo = getCurrentCycle();
                            
                            // Adicionar ao histórico de pagamentos
                            systemState.payments.push({
                                id: Date.now(),
                                name: targetClient.name || targetClient.login,
                                bank: 'Mercado Pago',
                                method: 'PIX',
                                value: `R$ ${charge.amount}`,
                                date: 'Hoje',
                                time: new Date().toLocaleTimeString()
                            });

                            // Notificar via WhatsApp se possível
                            if (whatsappStatus === 'CONNECTED' && targetClient.phone) {
                                // Limpa o número de telefone (remove tudo que não for número)
                                const cleanNumber = targetClient.phone.replace(/\D/g, '');
                                const msg = `✅ *PAGAMENTO CONFIRMADO*\n\nOlá ${targetClient.name}! Recebemos seu pagamento de R$ ${charge.amount}.\n\nSeu acesso foi liberado automaticamente. Obrigado!`;
                                whatsappClient.sendMessage(`${cleanNumber}@c.us`, msg).catch(e => console.error("[WA] Erro ao enviar confirmação:", e.message));
                            }
                        }
                        
                        activeCharges.splice(i, 1);
                        saveActiveCharges();
                        saveSystemState();
                    } else if (data.status === 'cancelled' || data.status === 'rejected') {
                        console.log(`[MONITOR] ❌ Cobrança ${charge.id} expirada ou recusada.`);
                        activeCharges.splice(i, 1);
                        saveActiveCharges();
                    }
                } catch(e) {
                    console.error(`[MONITOR] Erro ao verificar TXID ${charge.id}:`, e.message);
                }
            }
        }
    }

    // 2. Bloqueio Automático e Notificações (Roda em cada ciclo)
    let blocksCount = 0;
    const now = new Date();
    
    for (let i = 0; i < systemState.clients.length; i++) {
        const client = systemState.clients[i];
        const effective = getEffectiveStatus(client);
        
        console.log(`[MONITOR] 🔍 Analisando cliente (${i+1}/${systemState.clients.length}): ${client.login} | Status: ${effective}`);
        
        // Bloqueio por falta de pagamento
        if (effective === 'vencimento_bloqueio' && client.status !== 'bloqueado') {
            console.log(`[MONITOR] ⛔ Bloqueando cliente por atraso crítico: ${client.login}`);
            const command = `/ppp secret disable name="${client.login}"`;
            
            const hosts = (client.syncedMks || []).map(m => m.ip);
            if (hosts.length > 0) {
                for (const h of hosts) await internalExecute(command, h);
            } else {
                await internalExecute(command);
            }
            
            systemState.clients[i].status = 'bloqueado';
            blocksCount++;

            // Notificar bloqueio via WhatsApp
            if (whatsappStatus === 'CONNECTED' && client.phone) {
                const cleanNumber = client.phone.replace(/\D/g, '');
                const msg = `⚠️ *AVISO DE BLOQUEIO*\n\nOlá ${client.name}, seu acesso foi suspenso devido ao atraso no pagamento.\n\nPara liberar agora, efetue o pagamento via PIX no seu painel.`;
                whatsappClient.sendMessage(`${cleanNumber}@c.us`, msg).catch(e => {});
            }
        }

        // 3. AUTO COBRA ZAP: Notificação com PIX (1 dia antes ou no dia do atraso)
        if (!client.phone) {
            console.log(`[MONITOR] ⏭️ Pulando ${client.login}: Sem número de telefone.`);
        } else if (!mpToken) {
            console.log(`[MONITOR] ⏭️ Pulando ${client.login}: Configuração do Mercado Pago (Token) ausente.`);
        } else {
            if (whatsappStatus !== 'CONNECTED') {
                console.log(`[MONITOR] ⏳ Aguardando conexão do WhatsApp para cobrar ${client.login}`);
            } else {
                const lastSentKey = `last_wa_${client.id}`;
                const lastSent = client[lastSentKey] || 0;
                const dayMillis = 24 * 60 * 60 * 1000;
                const cleanNumber = client.phone.replace(/\D/g, '');

                if (Date.now() - lastSent <= dayMillis) {
                    console.log(`[MONITOR] ⏭️ Pulando ${client.login}: Já notificado nas últimas 24h.`);
                } else {
                    let msgPrefix = '';
                    if (effective === 'pre_vencimento') msgPrefix = `🔔 *LEMBRETE DE VENCIMENTO*\n\nOlá ${client.name}, sua fatura vence AMANHÃ.`;
                    else if (effective === 'atrasado') msgPrefix = `⚠️ *FATURA EM ATRASO*\n\nOlá ${client.name}, sua fatura está vencida. Evite o bloqueio pagando agora.`;
                    else if (effective === 'vencimento_bloqueio' || effective === 'bloqueado') msgPrefix = `🚫 *AVISO DE BLOQUEIO*\n\nOlá ${client.name}, seu acesso foi suspenso. Pague agora para liberar na hora.`;

                    if (!msgPrefix) {
                        console.log(`[MONITOR] ⏭️ Pulando ${client.login}: Status ${effective} não requer cobrança hoje.`);
                    } else {
                    console.log(`[AUTO-ZAP] 🚀 Iniciando cobrança para ${client.login} (${cleanNumber})`);
                    if (!mpToken) {
                        console.log(`[AUTO-ZAP] ❌ ERRO: Token Mercado Pago ausente!`);
                        continue;
                    }
                    
                    // Descobrir o valor do plano
                    const plan = systemState.plans.find(p => p.name === client.plan);
                    const priceStr = plan ? plan.price : '0';
                    const numericPrice = parseFloat(priceStr.replace(/[^\d,.]/g, '').replace(',', '.'));

                    console.log(`[AUTO-ZAP] 💰 Valor detectado: ${numericPrice} | Motivo: ${effective}`);

                    if (numericPrice > 0) {
                        // Gerar PIX Real via Mercado Pago
                        fetch('https://api.mercadopago.com/v1/payments', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${mpToken}`,
                                'X-Idempotency-Key': `auto_${client.id}_${Date.now()}`
                            },
                            body: JSON.stringify({
                                transaction_amount: numericPrice,
                                description: `Mensalidade Internet - ${client.name}`,
                                payment_method_id: 'pix',
                                payer: { email: 'financeiro@lstore.com.br' }
                            })
                        }).then(r => r.json()).then(data => {
                            if (data.point_of_interaction) {
                                const pixCode = data.point_of_interaction.transaction_data.qr_code;
                                const finalMsg = `${msgPrefix}\n\n*Valor:* R$ ${numericPrice.toFixed(2)}\n\n*PIX COPIA E COLA:*\n\n${pixCode}\n\n_Copie o código acima e cole no seu aplicativo do banco. A liberação é automática!_`;
                                
                                // Gerar imagem do QR Code
                                qrcode.toDataURL(pixCode).then(url => {
                                    const base64Data = url.split(',')[1];
                                    const media = new MessageMedia('image/png', base64Data, 'qrcode.png');
                                    
                                    whatsappClient.sendMessage(`${cleanNumber}@c.us`, media, { caption: finalMsg }).then(() => {
                                        console.log(`[AUTO-ZAP] ✅ Cobrança enviada com sucesso para ${client.login}`);
                                        systemState.clients[i][lastSentKey] = Date.now();
                                        saveSystemState(); 
                                        
                                        activeCharges.push({
                                            id: data.id.toString(),
                                            clientId: client.id,
                                            clientLogin: client.login,
                                            amount: numericPrice,
                                            status: 'pending',
                                            createdAt: new Date().toISOString()
                                        });
                                        saveActiveCharges();
                                    }).catch(e => console.error("[AUTO-ZAP] Erro ao enviar mensagem WhatsApp:", e.message));
                                }).catch(e => {
                                    console.error("[AUTO-ZAP] Erro ao gerar imagem QR Code:", e.message);
                                    // Fallback: tenta enviar apenas o texto se a imagem falhar
                                    whatsappClient.sendMessage(`${cleanNumber}@c.us`, finalMsg).catch(e => {});
                                });
                            }
                        }).catch(e => console.error("[AUTO-PIX] Erro ao gerar cobrança:", e.message));
                    }
                }
            }
        }
    }
}
    
    if (blocksCount > 0 || activeCharges.length === 0) {
        saveSystemState();
    }
}

// Monitoramento frequente (A cada 1 minuto)
setInterval(runBackgroundMonitor, 60 * 1000);
// Executa uma vez logo após iniciar (15 segundos depois)
setTimeout(runBackgroundMonitor, 15000);

// --- INICIALIZAÇÃO AUTOMÁTICA DO WHATSAPP ---
// Tenta conectar o WhatsApp automaticamente ao ligar o servidor
setTimeout(() => {
    console.log('[AUTO] Tentando conectar WhatsApp automaticamente...');
    initWhatsApp();
}, 5000);

app.use(express.static(path.join(__dirname, 'dist')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(3000, () => console.log(`LSTORE: http://localhost:3000`));
