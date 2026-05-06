import fs from 'fs';
import * as MikronodePkg from 'mikronode-ng';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const Mikronode = MikronodePkg.default || MikronodePkg;

const mikrotikConfig = {
    host: '192.168.0.110',
    user: 'lstore_admin',
    password: 'ls@2026',
    port: 8728
};

async function start() {
    try {
        const filePath = path.join(__dirname, 'cain', 'clientes_mikweb_temp.md');
        if (!fs.existsSync(filePath)) {
            console.log('Arquivo clientes_mikweb.md não encontrado!');
            return;
        }

        const file = fs.readFileSync(filePath, 'utf8');
        const regex = /\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
        const clients = [];
        let match;

        while ((match = regex.exec(file)) !== null) {
            const id = match[1].trim();
            const nome = match[2].trim();
            const status = match[3].trim();
            clients.push({ id, nome, status });
        }

        console.log(`Encontrados ${clients.length} clientes na lista.`);

        console.log(`Conectando ao Mikrotik em ${mikrotikConfig.host}...`);
        const connection = Mikronode.getConnection(mikrotikConfig.host, mikrotikConfig.user, mikrotikConfig.password);

        connection.on('error', (err) => {
            console.error('Erro de conexão Mikrotik:', err.message);
        });

        const connectPromise = connection.getConnectPromise();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tempo limite de conexão esgotado')), 10000)
        );

        await Promise.race([connectPromise, timeoutPromise]);
        console.log('Conectado ao Mikrotik! Iniciando o cadastro de clientes...');

        let i = 0;
        let successCount = 0;
        let errorCount = 0;

        for (const client of clients) {
            i++;
            const name = client.nome;
            const password = client.id;
            
            console.log(`[${i}/${clients.length}] Cadastrando: ${name}`);

            await new Promise((resolve) => {
                const ch = connection.openChannel();
                
                ch.write('/ppp/secret/add', {
                    '=name': name,
                    '=password': password,
                    '=profile': 'default',
                    '=service': 'pppoe',
                    '=comment': `ID: ${client.id} | Status: ${client.status}`
                });

                ch.on('done', (data) => {
                    successCount++;
                    resolve();
                });

                ch.on('trap', (err) => {
                    console.log(`  -> Aviso/Erro ao adicionar ${name} (talvez já exista)`);
                    errorCount++;
                    resolve();
                });
            });
            
            // Pequena pausa para não sobrecarregar o roteador
            await new Promise(r => setTimeout(r, 50));
        }

        console.log(`\nResumo da Importação:`);
        console.log(`Total processados: ${clients.length}`);
        console.log(`Sucesso: ${successCount}`);
        console.log(`Erros/Já existentes: ${errorCount}`);

        connection.close();

    } catch (e) {
        console.error('Erro na execução do script:', e.message);
        process.exit(1);
    }
}

start();
