import * as MikronodePkg from 'mikronode-ng';

const Mikronode = MikronodePkg.default || MikronodePkg;

const connection = Mikronode.getConnection('192.168.0.105', 'lstore_admin', 'ls@2026');

connection.on('error', (err) => console.error('Erro:', err));

connection.getConnectPromise().then(() => {
    const channel = connection.openChannel();
    channel.write('/ppp/secret/print');
    
    channel.on('done', (data) => {
        const items = Mikronode.parseItems(data);
        console.log(items.slice(0, 5));
        connection.close();
    });
}).catch(err => console.error('Falha na conexao:', err));
