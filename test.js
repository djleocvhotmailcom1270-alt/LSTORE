const cmd = '/ppp profile add name="test" rate-limit="100m/100m"';
fetch('http://localhost:3000/api/execute', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ command: cmd, host: '192.168.0.105' }) 
}).then(r=>r.json()).then(console.log).catch(console.error);
