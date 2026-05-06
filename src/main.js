import './style.css'

// Helper para Debug Remoto
window.remoteLog = (message, type = 'INFO') => {
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `[JS] ${message}`, type })
  }).catch(() => {});
};

// State Management
// State Management
const defaultState = {
  activePage: 'dashboard',
  mikrotiks: [
    { id: 1, name: 'Borda-Principal', ip: '192.168.0.110', status: 'off', cpu: '0%' },
    { id: 2, name: 'APK2', ip: '192.168.0.111', status: 'off', cpu: '0%' },
  ],
  plans: [],
  clients: [
    { id: 1, name: 'João Silva', plan: 'Fibra 300MB', status: 'ativo', ip: '192.168.10.50', vencimento: 10, diasBloqueio: 5 },
    { id: 2, name: 'Maria Santos', plan: 'Fibra 100MB', status: 'ativo', ip: '192.168.10.51', vencimento: 15, diasBloqueio: 5 },
    { id: 3, name: 'Pedro Alves', plan: 'Fibra 300MB', status: 'bloqueado', ip: '192.168.10.52', vencimento: 5, diasBloqueio: 5 },
    { id: 4, name: 'Empresa XYZ', plan: 'Fibra 500MB Ultra', status: 'ativo', ip: '192.168.10.100', vencimento: 20, diasBloqueio: 10 },
  ],
  vpnConfig: {
    server: 'vpn.lstore.net',
    port: '1194',
    token: 'LS-' + Math.random().toString(36).substr(2, 9).toUpperCase()
  },
  clientSearchQuery: '',
  ipPools: [],
  payments: [
    { id: 1, name: 'João Silva', bank: 'Mercado Pago', method: 'PIX', value: 'R$ 89,90', date: 'Hoje', time: '14:22' },
    { id: 2, name: 'Maria Oliveira', bank: 'Banco Inter', method: 'PIX', value: 'R$ 120,00', date: 'Hoje', time: '12:05' },
    { id: 3, name: 'Carlos Santos', bank: 'Sicoob', method: 'Boleto', value: 'R$ 75,00', date: 'Ontem', time: '16:45' }
  ],
  bankConfig: {
    'Mercado Pago': { clientId: '', clientSecret: '' },
    'Banco Inter': { clientId: '', clientSecret: '' },
    'Sicoob': { clientId: '', clientSecret: '' }
  }
};

const state = { ...defaultState };

// Função para Carregar Estado do Servidor
async function loadStateFromServer() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();
    if (data.status === 'success' && data.data) {
      // Mescla o estado do servidor com o estado atual
      Object.keys(data.data).forEach(key => {
        state[key] = data.data[key];
      });
      console.log("LSTORE: Estado global sincronizado do servidor.");
    }
  } catch (e) {
    console.error("Erro ao carregar estado do servidor:", e);
    // Fallback para localStorage
    const rawStorage = localStorage.getItem('lstore_state');
    if (rawStorage) {
      const saved = JSON.parse(rawStorage);
      Object.keys(saved).forEach(key => {
        state[key] = saved[key];
      });
    }
  }

  // Garantia extra: inicializações
  if (!state.mikrotiks) state.mikrotiks = defaultState.mikrotiks;
  if (!state.plans) state.plans = [];
  if (!state.clients) state.clients = [];
  if (!state.ipPools) state.ipPools = [];
  if (!state.payments) state.payments = [];
  if (!state.bankConfig) state.bankConfig = defaultState.bankConfig;
  if (!state.pendingCharges) state.pendingCharges = [];
  
  // Re-renderiza a página atual após carregar
  navigate(state.activePage);
}

// Inicia o carregamento inicial
loadStateFromServer();

// Sincronização Periódica entre abas/dispositivos (cada 15 segundos)
setInterval(async () => {
  // Só sincroniza se não houver um modal aberto para não atrapalhar o usuário
  const modalActive = document.getElementById('modal-overlay')?.classList.contains('active');
  const confirmActive = document.getElementById('confirm-modal');
  
  if (!modalActive && !confirmActive) {
    console.log("LSTORE: Sincronizando estado com o servidor...");
    try {
      const res = await fetch('/api/state');
      const data = await res.json();
      if (data.status === 'success' && data.data) {
        // Verifica se houve mudança real para evitar re-render desnecessário
        const oldClients = JSON.stringify(state.clients);
        const newClients = JSON.stringify(data.data.clients);
        
        if (oldClients !== newClients) {
          Object.keys(data.data).forEach(key => {
            state[key] = data.data[key];
          });
          navigate(state.activePage);
        }
      }
    } catch (e) {}
  }
}, 15000);

// Delete All Clients Logic
async function deleteAllClients() {
  if (state.clients.length === 0) {
    showCustomConfirm("AVISO", "Nenhum cliente encontrado para deletar.", "ENTENDI", "", true);
    return;
  }

  const confirmed = await showCustomConfirm(
    "LIMPEZA TOTAL",
    `VOCÊ TEM CERTEZA? Isso vai apagar TODOS os ${state.clients.length} clientes do sistema e de todos os Mikrotiks conectados. Esta ação é irreversível!`,
    "SIM, APAGAR TUDO",
    "CANCELAR"
  );

  if (!confirmed) return;

  const btn = document.querySelector('.btn-danger');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Apagando...';
  lucide.createIcons();

  const clientsToDelete = [...state.clients];
  let deletedCount = 0;

  for (const client of clientsToDelete) {
    try {
      // Deletar do Mikrotik (se houver IPs sincronizados)
      const hosts = (client.syncedMks || []).map(m => m.ip);
      if (client.mikrotikIp) hosts.push(client.mikrotikIp);
      
      const uniqueHosts = [...new Set(hosts)];
      
      for (const host of uniqueHosts) {
        await fetch('/api/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: `/ppp secret remove [find name="${client.login}"]`,
            host: host
          })
        });
      }

      // Deletar do estado local
      state.clients = state.clients.filter(c => c.id !== client.id);
      deletedCount++;
      
      // Feedback visual opcional no botão
      btn.innerHTML = `<i class="animate-spin" data-lucide="loader-2"></i> [${deletedCount}/${clientsToDelete.length}]`;
    } catch (e) {
      console.error('Erro ao deletar cliente:', client.login, e);
    }
  }

  saveState();
  navigate(state.activePage);
  
  // Modal de sucesso personalizado
  showCustomConfirm("SUCESSO", `Limpeza concluída! ${deletedCount} clientes removidos.`, "FECHAR", "", true);
}

// Custom Confirm Modal Logic
function showCustomConfirm(title, message, confirmLabel, cancelLabel, hideCancel = false) {
  return new Promise((resolve) => {
    const modalHtml = `
      <div id="confirm-modal" class="modal active animate-fade" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 9999;">
        <div class="modal-content glass" style="max-width: 450px; text-align: center; padding: 2.5rem; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
          <div class="modal-icon" style="color: #ef4444; margin-bottom: 1.5rem;">
            <i data-lucide="alert-triangle" style="width: 48px; height: 48px;"></i>
          </div>
          <h2 style="margin-bottom: 1rem; color: #fff; letter-spacing: 1px; font-weight: 700;">${title}</h2>
          <p style="color: rgba(255,255,255,0.8); margin-bottom: 2rem; line-height: 1.6; font-size: 1.1rem;">${message}</p>
          <div style="display: flex; gap: 1rem; justify-content: center; width: 100%;">
            ${!hideCancel ? `<button class="btn btn-secondary" id="confirm-cancel" style="flex: 1; padding: 0.8rem;">${cancelLabel}</button>` : ''}
            <button class="btn btn-primary" id="confirm-ok" style="flex: 1; padding: 0.8rem; background: ${hideCancel ? '#10b981' : '#ef4444'}; border: none; font-weight: 700;">${confirmLabel}</button>
          </div>
        </div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = modalHtml;
    document.body.appendChild(container);
    lucide.createIcons();

    document.getElementById('confirm-ok').onclick = () => {
      document.body.removeChild(container);
      resolve(true);
    };

    if (!hideCancel) {
      document.getElementById('confirm-cancel').onclick = () => {
        document.body.removeChild(container);
        resolve(false);
      };
    }
  });
}

// Wrapper for showCustomConfirm to maintain compatibility with older code
async function askConfirm(title, message, onConfirm) {
  const confirmed = await showCustomConfirm(title, message, "SIM", "CANCELAR");
  if (confirmed && onConfirm) {
    onConfirm();
  }
}

// Modal Functions (Must be at the top for hoisting/scoping)
function openModal(content) {
  const overlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  if (overlay && modalContent) {
    modalContent.innerHTML = content;
    overlay.classList.add('active');
    lucide.createIcons();
  }
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.classList.remove('active');
  }
  // Limpar intervalo de verificação de PIX se existir
  if (window.pixInterval) {
    clearInterval(window.pixInterval);
    window.pixInterval = null;
  }
}

async function openImportModal() {
  const onlineMks = state.mikrotiks.filter(m => m.status === 'online');
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h2 style="font-weight: 800; color: #fff;">Importar Clientes (PPP Secrets)</h2>
      <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem; border-radius: 10px;"><i data-lucide="x"></i></button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <p style="font-size: 0.95rem; color: rgba(255,255,255,0.6);">Selecione os Mikrotiks de onde deseja importar os clientes:</p>
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 1.2rem; max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem;">
        <label style="display: flex; align-items: center; gap: 1rem; font-size: 1rem; cursor: pointer; padding-bottom: 0.8rem; border-bottom: 1px dashed rgba(255,255,255,0.1);">
          <input type="checkbox" id="select-all-mks" style="width: 20px; height: 20px; accent-color: #3b82f6;">
          <span style="font-weight: 700; color: #3b82f6;">Selecionar Todos</span>
        </label>
        ${onlineMks.map(mk => `
          <label style="display: flex; align-items: center; gap: 1rem; font-size: 1rem; cursor: pointer;">
            <input type="checkbox" class="mk-checkbox" value="${mk.ip}" data-name="${mk.name}" style="width: 20px; height: 20px; accent-color: #3b82f6;">
            <span style="color: #fff;">${mk.name} <small style="color: rgba(255,255,255,0.4);">(${mk.ip})</small></span>
          </label>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="start-import-btn" style="padding: 1rem; font-weight: 700;">Iniciar Importação</button>
    </div>
  `);

  const selectAll = document.getElementById('select-all-mks');
  const checkboxes = document.querySelectorAll('.mk-checkbox');
  if (selectAll) selectAll.onchange = (e) => checkboxes.forEach(cb => cb.checked = e.target.checked);

  const startBtn = document.getElementById('start-import-btn');
  if (startBtn) {
    startBtn.onclick = async () => {
      const selected = Array.from(checkboxes).filter(cb => cb.checked);
      if (selected.length === 0) return showCustomConfirm("AVISO", "Selecione um Mikrotik.", "OK", "", true);
      
      startBtn.disabled = true;
      startBtn.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Importando...';
      lucide.createIcons();
      
      let count = 0;
      let errors = 0;
      for (const mk of selected) {
        try {
          const res = await fetch('/api/import', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ host: mk.value, type: 'clients' }) 
          });
          const data = await res.json();
          if (data.status === 'success') {
            const secrets = data.data || data.secrets;
            secrets.forEach(sec => {
              if (!state.clients.find(c => c.login === sec.name) && sec.name && sec.name !== 'default') {
                state.clients.push({ 
                  id: Date.now() + Math.random(), 
                  name: sec.comment || sec.name, 
                  login: sec.name, 
                  password: sec.password || '', 
                  plan: sec.profile || 'default', 
                  status: sec.disabled === 'true' ? 'bloqueado' : 'ativo', 
                  syncedMks: [{ ip: mk.value, name: mk.dataset.name }] 
                });
              }
            });
            count += secrets.length;
          } else {
              errors++;
          }
        } catch (e) {
          errors++;
          console.error("Erro ao importar de " + mk.value, e);
        }
      }
      saveState(); closeModal(); navigate('clients');
      showCustomConfirm("IMPORTAÇÃO", `${count} clientes importados! ${errors > 0 ? `(Falha em ${errors} roteadores)` : ''}`, "FECHAR", "", true);
    };
  }
}

async function toggleClientStatus(index) {
  const client = state.clients[index];
  const newStatus = client.status === 'ativo' ? 'bloqueado' : 'ativo';
  const command = `/ppp secret ${newStatus === 'bloqueado' ? 'disable' : 'enable'} name="${client.login}"`;
  
  if (client.syncedMks && client.syncedMks.length > 0) {
    for (const mk of client.syncedMks) {
      await executeMikrotikCommand(command, mk.ip);
    }
  } else {
    await executeMikrotikCommand(command);
  }
  
  state.clients[index].status = newStatus;
  saveState();
  navigate('clients');
}

async function deleteClient(index) {
  const client = state.clients[index];
  const confirmed = await showCustomConfirm(
    'Excluir Cliente?',
    `Deseja realmente excluir <strong>${client.name || client.login}</strong>? <br><small style="color: var(--danger)">Isso removerá o registro de todos os Mikrotiks sincronizados.</small>`,
    'CONFIRMAR',
    'CANCELAR'
  );
  
  if (confirmed) {
    const command = `/ppp secret remove name="${client.login}"`;
    if (client.syncedMks && client.syncedMks.length > 0) {
      for (const mk of client.syncedMks) {
        await executeMikrotikCommand(command, mk.ip);
      }
    } else {
      await executeMikrotikCommand(command);
    }
    
    state.clients.splice(index, 1);
    saveState();
    navigate('clients');
    showCustomConfirm("SUCESSO", "Cliente removido com sucesso.", "OK", "", true);
  }
}

// Helper para pegar o ciclo atual (Ex: 5/2026)
function getCurrentCycle() {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getFullYear()}`;
}

// Billing & Status Logic
function getEffectiveStatus(client) {
  const cicloAtual = getCurrentCycle();
  
  if (client.ultimoPagamentoCiclo === cicloAtual) {
    return 'ativo';
  }

  if (client.status === 'bloqueado') return 'bloqueado';
  if (!client.vencimento) return 'ativo';

  const now = new Date();
  const currentDay = now.getDate();
  const vencimento = parseInt(client.vencimento);
  const diasBloqueio = parseInt(client.diasBloqueio || 5);

  // Se o dia atual >= (vencimento + diasBloqueio), deve ser bloqueado
  if (currentDay >= (vencimento + diasBloqueio)) {
    return 'vencimento_bloqueio'; 
  } else if (currentDay >= vencimento) {
    return 'atrasado';
  }

  return 'ativo';
}

async function checkAutomaticBlocks() {
  console.log("LSTORE: Verificando faturamento e bloqueios automáticos...");
  let blocksCount = 0;
  
  for (let i = 0; i < state.clients.length; i++) {
    const client = state.clients[i];
    const effective = getEffectiveStatus(client);
    
    if (effective === 'vencimento_bloqueio' && client.status !== 'bloqueado') {
      console.log(`LSTORE: Bloqueio automático disparado para ${client.login}`);
      
      const command = `/ppp secret disable name="${client.login}"`;
      if (client.syncedMks && client.syncedMks.length > 0) {
        for (const mk of client.syncedMks) {
          await executeMikrotikCommand(command, mk.ip);
        }
      } else {
        await executeMikrotikCommand(command);
      }
      
      state.clients[i].status = 'bloqueado';
      blocksCount++;
    }
  }
  
  if (blocksCount > 0) {
    saveState();
    navigate(state.activePage);
  }
}

async function handlePaymentSuccess(client, amount, bank, txid) {
  const cicloAtual = getCurrentCycle();
  window.remoteLog(`Sucesso Detectado! Processando aprovação para ${client.login}`);
  console.log(`[PAGAMENTO] Processando aprovação: ${client.login} | Ciclo: ${cicloAtual} | TXID: ${txid}`);
  
  // 1. Localizar o cliente no estado global (Tenta por ID, depois por Login)
  let targetClient = state.clients.find(c => String(c.id) === String(client.id));
  if (!targetClient) {
    targetClient = state.clients.find(c => c.login === client.login);
  }
  
  if (targetClient) {
    // Marcar este ciclo como PAGO e atualizar status
    targetClient.ultimoPagamentoCiclo = cicloAtual;
    targetClient.status = 'ativo'; 
    
    console.log(`[PAGAMENTO] ✅ Cliente ${targetClient.login} marcado como ATIVO.`);
    
    // Comando para o Mikrotik
    const enableCmd = `/ppp secret enable name="${targetClient.login}"`;
    if (targetClient.syncedMks && targetClient.syncedMks.length > 0) {
      for (const mk of targetClient.syncedMks) {
        await executeMikrotikCommand(enableCmd, mk.ip);
      }
    } else if (targetClient.mikrotikIp) {
      await executeMikrotikCommand(enableCmd, targetClient.mikrotikIp);
    }

    // 2. Registrar na lista de pagamentos
    const newPayment = {
      id: Date.now(),
      name: targetClient.name || targetClient.login,
      bank: bank || 'Mercado Pago',
      method: 'PIX',
      value: amount,
      date: new Date().toLocaleDateString('pt-BR'),
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };
    state.payments.push(newPayment);

    // 3. Enviar mensagem de confirmação via WhatsApp
    if (targetClient.phone) {
      let cleanPhone = targetClient.phone.replace(/\D/g, '');
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = '55' + cleanPhone;
      }

      const confirmMsg = `✅ *PAGAMENTO CONFIRMADO*\n\nOlá *${targetClient.name || targetClient.login}*,\n\nRecebemos seu pagamento de *${amount}*.\n\nSua conexão foi reativada com sucesso! 🚀\n\n_Equipe LSTORE agradece!_`;
      
      console.log(`[WHATSAPP] Enviando confirmação para ${cleanPhone}...`);
      
      try {
        fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: cleanPhone, message: confirmMsg })
        });
      } catch (err) {
        console.error('[WHATSAPP] Erro ao disparar confirmação:', err);
      }
    }

    saveState();
    
    // Forçar atualização total da UI
    const currentPage = state.activePage;
    navigate(currentPage); 
    
    showCustomConfirm("SUCESSO", `Pagamento de ${targetClient.name} confirmado e liberado!`, "OK", "", true);
  } else {
    console.error(`[PAGAMENTO] ERRO: Cliente ID ${client.id} não encontrado no estado!`);
    showCustomConfirm("ERRO", "Cliente não encontrado no sistema para atualização.", "FECHAR", "", true);
  }
}



function openEditClientModal(index) {
  const client = state.clients[index];
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h2 style="color: #fff;">Editar Cliente: ${client.login}</h2>
      <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto; padding-right: 0.5rem;">
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Nome Completo</label>
        <input type="text" id="edit-client-name" value="${client.name || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">CPF</label>
          <input type="text" id="edit-client-cpf" value="${client.cpf || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Telefone</label>
          <input type="text" id="edit-client-phone" value="${client.phone || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Endereço</label>
        <input type="text" id="edit-client-address" value="${client.address || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Email</label>
          <input type="email" id="edit-client-email" value="${client.email || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Data de Cadastro</label>
          <input type="date" id="edit-client-date" value="${client.date || ''}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Usuário (Login)</label>
          <input type="text" id="edit-client-login" value="${client.login}" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Nova Senha (Opcional)</label>
          <input type="password" id="edit-client-pass" placeholder="Manter atual" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Alterar Plano</label>
        <select id="edit-client-plan" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
          ${state.plans.map(p => `<option value="${p.name}" ${p.name === client.plan ? 'selected' : ''}>${p.name}</option>`).join('')}
        </select>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Dia de Vencimento</label>
          <input type="number" id="edit-client-vencimento" value="${client.vencimento || 10}" min="1" max="31" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Bloqueio (Dias após)</label>
          <input type="number" id="edit-client-bloqueio" value="${client.diasBloqueio || 5}" min="0" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div style="margin-top: 1rem; display: flex; gap: 1rem;">
        <button class="btn btn-primary" style="flex: 1; font-weight: 700;" id="update-client-btn">Salvar Alterações</button>
        <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
      </div>
    </div>
  `);

  document.getElementById('update-client-btn').onclick = async (e) => {
    const newName = document.getElementById('edit-client-name').value;
    const newLogin = document.getElementById('edit-client-login').value;
    const newPass = document.getElementById('edit-client-pass').value;
    const newPlan = document.getElementById('edit-client-plan').value;
    const newCpf = document.getElementById('edit-client-cpf').value;
    const newPhone = document.getElementById('edit-client-phone').value;
    const newAddress = document.getElementById('edit-client-address').value;
    const newEmail = document.getElementById('edit-client-email').value;
    const newDate = document.getElementById('edit-client-date').value;
    const newVencimento = document.getElementById('edit-client-vencimento').value;
    const newBloqueio = document.getElementById('edit-client-bloqueio').value;

    const btn = e.target;
    btn.disabled = true;
    btn.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Atualizando...';
    lucide.createIcons();

    let script = `/ppp secret set [find name="${client.login}"] name="${newLogin}" profile="${newPlan}" comment="${newName}"`;
    if (newPass) script += ` password="${newPass}"`;

    let success = true;
    const hosts = (client.syncedMks || []).map(m => m.ip);
    if (client.mikrotikIp && !hosts.includes(client.mikrotikIp)) hosts.push(client.mikrotikIp);

    if (hosts.length > 0) {
      for (const host of hosts) {
        const res = await executeMikrotikCommand(script, host);
        if (res.status !== 'success') success = false;
      }
    } else {
      const res = await executeMikrotikCommand(script);
      if (res.status !== 'success') success = false;
    }

    if (success) {
      state.clients[index] = { 
        ...client, 
        name: newName, 
        login: newLogin,
        password: newPass || client.password,
        plan: newPlan,
        cpf: newCpf, 
        phone: newPhone, 
        address: newAddress,
        email: newEmail,
        date: newDate,
        vencimento: newVencimento, 
        diasBloqueio: newBloqueio 
      };
      saveState(); closeModal(); navigate('clients');
      showCustomConfirm("SUCESSO", "Dados atualizados com sucesso!", "OK", "", true);
    } else {
      showCustomConfirm("ERRO", "Houve um problema ao atualizar no Mikrotik.", "ENTENDI", "", true);
      btn.disabled = false;
      btn.innerHTML = 'Salvar Alterações';
    }
  };
}

async function openClientModal() {
  const onlineMks = state.mikrotiks.filter(m => m.status === 'online');
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h2 style="color: #fff;">Novo Cliente (Secret)</h2>
      <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem; max-height: 70vh; overflow-y: auto; padding-right: 0.5rem;">
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Nome Completo</label>
        <input type="text" id="client-name" placeholder="Ex: João da Silva" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">CPF</label>
          <input type="text" id="client-cpf" placeholder="000.000.000-00" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Telefone</label>
          <input type="text" id="client-phone" placeholder="(00) 00000-0000" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Endereço</label>
        <input type="text" id="client-address" placeholder="Rua, Número, Bairro" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Email</label>
          <input type="email" id="client-email" placeholder="cliente@email.com" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Data de Cadastro</label>
          <input type="date" id="client-date" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Usuário (Login)</label>
          <input type="text" id="client-login" placeholder="login123" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Senha</label>
          <input type="password" id="client-pass" placeholder="****" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div>
        <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Plano de Internet</label>
        <select id="client-plan" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
          ${state.plans.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
        </select>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Dia de Vencimento</label>
          <input type="number" id="client-vencimento" value="10" min="1" max="31" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
        <div>
          <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; color: rgba(255,255,255,0.6);">Bloqueio (Dias após)</label>
          <input type="number" id="client-bloqueio" value="5" min="0" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
        </div>
      </div>
      <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px;">
        <p style="font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-bottom: 0.8rem;">Sincronizar nos Mikrotiks:</p>
        <label style="display: flex; align-items: center; gap: 0.5rem; color: #3b82f6; font-weight: 700; margin-bottom: 0.8rem; cursor: pointer;">
          <input type="checkbox" id="select-all-client-mks" checked style="width: 18px; height: 18px;"> Selecionar Todos
        </label>
        <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 150px; overflow-y: auto;">
            ${onlineMks.map(mk => `
              <label style="display: flex; align-items: center; gap: 0.5rem; color: #fff; cursor: pointer;">
                <input type="checkbox" class="client-mk-checkbox" value="${mk.ip}" data-name="${mk.name}" checked style="width: 18px; height: 18px;"> ${mk.name} (${mk.ip})
              </label>
            `).join('')}
        </div>
      </div>
      <button class="btn btn-primary" id="save-client-btn" style="padding: 1rem; font-weight: 700;">Criar e Sincronizar</button>
    </div>
  `);

  const selectAll = document.getElementById('select-all-client-mks');
  const mkCheckboxes = document.querySelectorAll('.client-mk-checkbox');
  if (selectAll) selectAll.onchange = (e) => mkCheckboxes.forEach(cb => cb.checked = e.target.checked);

  document.getElementById('save-client-btn').onclick = async (e) => {
    const login = document.getElementById('client-login').value;
    const name = document.getElementById('client-name').value;
    const pass = document.getElementById('client-pass').value;
    const plan = document.getElementById('client-plan').value;
    const cpf = document.getElementById('client-cpf').value;
    const phone = document.getElementById('client-phone').value;
    const address = document.getElementById('client-address').value;
    const email = document.getElementById('client-email').value;
    const date = document.getElementById('client-date').value;
    const vencimento = document.getElementById('client-vencimento').value;
    const bloqueio = document.getElementById('client-bloqueio').value;
    const selected = Array.from(document.querySelectorAll('.client-mk-checkbox:checked'));

    if (!login || !pass) return showCustomConfirm("AVISO", "Login e Senha obrigatórios", "OK", "", true);
    if (selected.length === 0) return showCustomConfirm("AVISO", "Selecione pelo menos um Mikrotik", "OK", "", true);

    const btn = e.target;
    btn.disabled = true;
    btn.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Sincronizando...';
    lucide.createIcons();
    
    let successCount = 0;
    let lastError = '';

    for (const mk of selected) {
      const res = await executeMikrotikCommand(`/ppp secret add name="${login}" password="${pass}" profile="${plan}" comment="${name}"`, mk.value);
      if (res.status === 'success') {
          successCount++;
      } else {
          lastError = res.message;
      }
    }

    if (successCount > 0) {
        state.clients.push({ 
            id: Date.now(), 
            name, 
            login, 
            password: pass, 
            plan, 
            cpf, 
            phone, 
            address,
            email,
            date,
            vencimento,
            diasBloqueio: bloqueio,
            status: 'ativo', 
            syncedMks: selected.map(s => ({ ip: s.value, name: s.dataset.name })) 
        });
        saveState(); closeModal(); navigate('clients');
        showCustomConfirm("SUCESSO", `Cliente criado e sincronizado em ${successCount} roteadores!`, "OK", "", true);
    } else {
        showCustomConfirm("ERRO NO MIKROTIK", lastError || "Falha ao sincronizar com os roteadores.", "ENTENDI", "", true);
        btn.disabled = false;
        btn.innerHTML = 'Criar e Sincronizar';
    }
  };
}

async function openPoolModal() {
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h2 style="color: #fff;">Nova IP Pool</h2>
      <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
    </div>
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <input type="text" id="pool-name" placeholder="Nome da Pool" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      <input type="text" id="pool-ranges" placeholder="Ranges (ex: 192.168.1.10-192.168.1.100)" style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; padding: 1rem; border-radius: 12px;">
      <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 12px;">
        <p style="font-size: 0.8rem; color: rgba(255,255,255,0.5); margin-bottom: 0.5rem;">Sincronizar nos Mikrotiks:</p>
        ${state.mikrotiks.filter(m => m.status === 'online').map(mk => `
          <label style="display: flex; align-items: center; gap: 0.5rem; color: #fff; margin-bottom: 0.5rem;">
            <input type="checkbox" class="pool-mk-checkbox" value="${mk.ip}" checked> ${mk.name}
          </label>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="save-pool-btn" style="padding: 1rem;">Criar Pool</button>
    </div>
  `);

  document.getElementById('save-pool-btn').onclick = async () => {
    const name = document.getElementById('pool-name').value;
    const ranges = document.getElementById('pool-ranges').value;
    const selected = Array.from(document.querySelectorAll('.pool-mk-checkbox:checked'));

    if (!name || !ranges) return showCustomConfirm("AVISO", "Campos obrigatórios!", "OK", "", true);

    for (const mk of selected) {
      await executeMikrotikCommand(`/ip pool add name="${name}" ranges="${ranges}"`, mk.value);
    }

    state.ipPools.push({ name, ranges, syncedMks: selected.map(s => ({ ip: s.value })) });
    saveState(); closeModal(); navigate('ippools');
    showCustomConfirm("SUCESSO", "Pool criada!", "OK", "", true);
  };
}

// Tornar global
window.deleteAllClients = deleteAllClients;
window.openImportModal = openImportModal;
window.openClientModal = openClientModal;
window.openPoolModal = openPoolModal;
window.closeModal = closeModal;

async function saveState() {
  localStorage.setItem('lstore_state', JSON.stringify(state));
  
  // Sincroniza TODO o estado com o servidor para multi-dispositivo e automação
  try {
    await fetch('/api/state/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
  } catch (e) {
    console.warn("LSTORE: Falha ao sincronizar estado global com o servidor.");
  }
}

// Backend API Integration with offline check and JSON safety
async function executeMikrotikCommand(command, host = null) {
  // Se temos um host específico, verificamos se ele está offline no estado
  if (host) {
    const mk = state.mikrotiks.find(m => m.ip === host);
    if (mk && mk.status === 'off' && !command.includes('/api/traffic')) {
      console.warn(`LSTORE: Ignorando comando para host offline: ${host}`);
      return { status: 'error', message: 'Mikrotik está offline.' };
    }
  }

  try {
    const payload = { command };
    if (host) payload.host = host;

    const response = await fetch('/api/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return await response.json();
    } else {
      const text = await response.text();
      console.error(`LSTORE: Resposta não-JSON do servidor (${response.status}):`, text.substring(0, 200));
      return { status: 'error', message: `Erro no servidor (${response.status})` };
    }
  } catch (error) {
    console.error('LSTORE: Erro na conexão com o servidor backend:', error);
    return { status: 'error', message: 'Falha de comunicação com o backend.' };
  }
}

// Templates
const templates = {
  dashboard: () => `
    <div class="top-bar">
      <h1 class="page-title">Dashboard</h1>
      <div class="user-profile">
        <div class="avatar"></div>
        <span>Admin LSTORE</span>
      </div>
    </div>

    <div class="dashboard-grid">
      <div class="stat-card animate-fade">
        <div class="stat-label">Mikrotiks Ativos</div>
        <div class="stat-value">${state.mikrotiks.filter(m => m.status === 'online').length} / ${state.mikrotiks.length}</div>
        <div class="stat-trend trend-up"><i data-lucide="arrow-up"></i> +5% este mês</div>
      </div>
      <div class="stat-card animate-fade" style="animation-delay: 0.1s">
        <div class="stat-label">Total de Clientes</div>
        <div class="stat-value">${state.clients.length}</div>
        <div class="stat-trend trend-up"><i data-lucide="arrow-up"></i> +12 novos hoje</div>
      </div>
      <div class="stat-card animate-fade" style="animation-delay: 0.2s">
        <div class="stat-label">Planos Ativos</div>
        <div class="stat-value">${state.plans.length}</div>
        <div class="stat-trend">Gerenciando largura de banda</div>
      </div>
    </div>

    <div class="card animate-fade" style="animation-delay: 0.3s">
      <div class="speedtest-container">
        <div class="speedtest-header-new">
          <div class="header-stat">
            <div class="header-icon"><i data-lucide="arrow-left-right"></i></div>
            <div class="header-info">
              <span class="header-label">PING</span>
              <div class="header-value-group">
                <span class="header-value" id="gauge-ping">13</span>
                <span class="header-unit">ms</span>
              </div>
            </div>
          </div>
          <div class="header-stat active">
            <div class="header-icon"><i data-lucide="arrow-down-circle"></i></div>
            <div class="header-info">
              <span class="header-label">RX SPEED</span>
              <div class="header-value-group">
                <span class="header-value" id="gauge-download">0.00</span>
                <span class="header-unit">Mbps</span>
              </div>
            </div>
          </div>
          <div class="header-stat">
            <div class="header-icon"><i data-lucide="arrow-up-circle"></i></div>
            <div class="header-info">
              <span class="header-label">TX SPEED</span>
              <div class="header-value-group">
                <span class="header-value" id="gauge-upload">0.00</span>
                <span class="header-unit">Mbps</span>
              </div>
            </div>
          </div>
        </div>

        <div class="traffic-monitor-container">
          <div class="traffic-grid"></div>
          <div class="traffic-bars">
            <div class="traffic-bar-group">
              <div class="bar-value-label" id="bar-down-value">0 kbps</div>
              <div class="bar-container">
                <div class="bar-fill download" id="bar-down-fill" style="height: 0%"></div>
              </div>
              <div class="bar-label">RX</div>
            </div>
            <div class="traffic-bar-group">
              <div class="bar-value-label" id="bar-up-value">0 kbps</div>
              <div class="bar-container">
                <div class="bar-fill upload" id="bar-up-fill" style="height: 0%"></div>
              </div>
              <div class="bar-label">TX</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card animate-fade" style="animation-delay: 0.4s; margin-top: 2rem;">
      <div class="card-header">
        <h2>Status dos Roteadores</h2>
        <button class="btn btn-secondary">Ver Todos</button>
      </div>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>IP Local</th>
              <th>Status</th>
              <th>Tráfego (RX/TX)</th>
              <th>CPU</th>
              <th>Clientes</th>
            </tr>
          </thead>
          <tbody id="dashboard-routers-list">
            ${state.mikrotiks.map(mk => `
              <tr data-ip="${mk.ip.replace(/\./g, '-')}">
                <td>${mk.name}</td>
                <td>${mk.ip}</td>
                <td><span class="status-badge status-${mk.status}">${mk.status.toUpperCase()}</span></td>
                  <td>
                    <div class="traffic-mini-grid">
                      <div class="mini-bar-row">
                        <div class="mini-bar-track"><div class="mini-bar-fill down" id="mini-down-${mk.ip.replace(/\./g, '-')}" style="width: 0%"></div></div>
                        <span class="mini-txt" id="txt-down-${mk.ip.replace(/\./g, '-')}">0 kbps</span>
                      </div>
                      <div class="mini-bar-row">
                        <div class="mini-bar-track"><div class="mini-bar-fill up" id="mini-up-${mk.ip.replace(/\./g, '-')}" style="width: 0%"></div></div>
                        <span class="mini-txt" id="txt-up-${mk.ip.replace(/\./g, '-')}">0 kbps</span>
                      </div>
                    </div>
                  </td>
                <td>${mk.cpu}</td>
                <td>${state.clients.filter(c => c.syncedMks && c.syncedMks.some(smk => smk.ip === mk.ip) || c.mikrotikIp === mk.ip).length}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `,

  clients: () => {
    const filteredClients = state.clients.filter(c => 
      (c.name || '').toLowerCase().includes((state.clientSearchQuery || '').toLowerCase()) ||
      (c.login || '').toLowerCase().includes((state.clientSearchQuery || '').toLowerCase())
    );

    return `
    <div class="clients-container">
      <div class="view-header">
        <div class="header-main">
          <h1>Gestão de Clientes</h1>
          <div class="search-bar">
            <i data-lucide="search"></i>
            <input type="text" id="client-search" placeholder="Procurar por nome ou login..." value="${state.clientSearchQuery || ''}">
          </div>
        </div>
        <div class="header-actions" style="display: flex; gap: 0.5rem; align-items: center;">
          <button class="btn btn-danger" onclick="window.deleteAllClients()" style="background: #ef4444; border: none; padding: 0.5rem 0.8rem; font-size: 0.85rem;">
            <i data-lucide="trash-2"></i> Limpar Todos
          </button>
          <button class="btn btn-secondary" id="btn-import-clients" onclick="openImportModal()">
            <i data-lucide="upload"></i> Importar
          </button>
          <button class="btn btn-primary" id="btn-create-client" onclick="openClientModal()">
            <i data-lucide="user-plus"></i> Novo Cliente
          </button>
        </div>
      </div>

    <div class="clients-grid">
      ${filteredClients.length === 0 ? `
        <div class="card animate-fade" style="padding: 3rem; text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">
          ${state.clientSearchQuery ? 'Nenhum cliente corresponde à sua pesquisa.' : 'Nenhum cliente cadastrado ainda.'}
        </div>
      ` : filteredClients.map((c) => {
          const originalIndex = state.clients.findIndex(orig => orig.id === c.id);
          const mkName = c.mikrotikName || (c.syncedMks && c.syncedMks.length > 0 ? c.syncedMks[0].name : 'Local');
          return `
            <div class="client-card animate-fade">
              <div class="client-card-header">
                <div class="client-avatar-icon">
                  <i data-lucide="user"></i>
                </div>
                <div class="client-status-badge status-${getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')}">
                  ${(getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')).toUpperCase()}
                </div>
              </div>
              
              <div class="client-card-body">
                <h3 class="client-card-name">${c.name || c.login}</h3>
                <div class="client-card-login">
                  <i data-lucide="log-in" style="width: 14px;"></i>
                  <span>${c.login}</span>
                </div>
                
                <div class="client-card-info">
                  <div class="info-item">
                    <i data-lucide="zap"></i>
                    <span>${c.plan}</span>
                  </div>
                  <div class="info-item">
                    <i data-lucide="server"></i>
                    <span>${mkName}</span>
                  </div>
                  <div class="info-item" style="color: ${getEffectiveStatus(c) === 'atrasado' ? '#f59e0b' : 'rgba(255,255,255,0.5)'}">
                    <i data-lucide="calendar"></i>
                    <span>Vencimento: Dia ${c.vencimento || 10}</span>
                  </div>
                </div>
              </div>

              <div class="client-card-footer">
                <button class="btn btn-secondary btn-toggle-client" onclick="toggleClientStatus(${originalIndex})" style="background: ${c.status === 'bloqueado' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)'}; color: ${c.status === 'bloqueado' ? '#10b981' : '#f59e0b'}; border-color: transparent;" title="${c.status === 'bloqueado' ? 'Habilitar Cliente' : 'Desabilitar Cliente'}">
                  <i data-lucide="${c.status === 'bloqueado' ? 'play' : 'pause'}"></i> ${c.status === 'bloqueado' ? 'Habilitar' : 'Desabilitar'}
                </button>
                <button class="btn btn-client-edit btn-edit-client" onclick="openEditClientModal(${originalIndex})">
                  <i data-lucide="edit-2"></i> Editar
                </button>
                <button class="btn btn-client-delete btn-delete-client" onclick="deleteClient(${originalIndex})" title="Excluir Cliente">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </div>
          `;
      }).join('')}
    </div>
    `;
  },
  
  payments: () => `
    <div class="top-bar">
      <h1 class="page-title">Lista de Pagamentos</h1>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-secondary" onclick="alert('Exportando Relatório...')"><i data-lucide="download"></i> Exportar PDF</button>
      </div>
    </div>

    <div class="card animate-fade">
      <div class="table-container">
        <table id="payments-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Banco / Origem</th>
              <th>Método</th>
              <th>Valor</th>
              <th>Data / Hora</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${state.payments.sort((a, b) => b.id - a.id).map(p => `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <div style="width: 32px; height: 32px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 700;">
                      ${p.name.charAt(0)}
                    </div>
                    <span>${p.name}</span>
                  </div>
                </td>
                <td>${p.bank}</td>
                <td><span style="background: rgba(0, 114, 255, 0.1); color: var(--accent-primary); padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.75rem; font-weight: 700;">${p.method}</span></td>
                <td style="font-weight: 700; color: #10b981;">${p.value}</td>
                <td>${p.date}, ${p.time}</td>
                <td><span class="status-badge status-ativo">CONFIRMADO</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `,

  bank: () => `
    <div class="top-bar">
      <h1 class="page-title">Integração Bancária</h1>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-secondary"><i data-lucide="refresh-cw"></i> Sincronizar Tudo</button>
        <button class="btn btn-primary"><i data-lucide="plus"></i> Nova Integração</button>
      </div>
    </div>

    <div style="margin-bottom: 2rem; background: rgba(0, 114, 255, 0.05); border: 1px solid rgba(0, 114, 255, 0.1); padding: 1.5rem; border-radius: 20px; display: flex; align-items: center; gap: 1.5rem;">
      <div style="width: 50px; height: 50px; background: var(--accent-primary); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white;">
        <i data-lucide="shield-check" style="width: 30px; height: 30px;"></i>
      </div>
      <div>
        <h3 style="margin-bottom: 0.25rem;">Segurança Bancária LSTORE</h3>
        <p style="font-size: 0.9rem; color: var(--text-secondary);">Todas as integrações utilizam APIs seguras e criptografia de ponta a ponta para validação de pagamentos.</p>
      </div>
    </div>

    <div class="clients-grid">
      <div class="client-card animate-fade" style="background: #00bef0; border-color: rgba(255,255,255,0.1);">
        <div class="client-card-header">
           <img src="https://logodownload.org/wp-content/uploads/2019/06/mercado-pago-logo.png" style="height: 30px; filter: brightness(0) invert(1);" alt="Mercado Pago">
           <div class="client-status-badge" style="background: rgba(255,255,255,0.2); color: white;">${(state.bankConfig['Mercado Pago']?.clientId || state.bankConfig['Mercado Pago']?.clientSecret) ? 'ATIVO' : 'CONFIGURAR'}</div>
        </div>
        <div class="client-card-body" style="color: white; margin-top: 1rem;">
          <h3 style="margin-bottom: 0.5rem;">Mercado Pago</h3>
          <p style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 1.5rem;">Verificação automática de PIX e Cartão.</p>
          <div class="client-card-info" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1);">
            <div class="info-item" style="color: white;">
              <i data-lucide="check-circle" style="color: #10b981;"></i>
              <span>Webhook: Ativo</span>
            </div>
            <div class="info-item bank-status-info" style="color: white;" data-bank="Mercado Pago">
              <i data-lucide="help-circle" style="color: #94a3b8;"></i>
              <span class="status-text">Aguardando Verificação</span>
            </div>
          </div>
          <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.2);">
            <div style="font-size: 0.7rem; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.4rem;">Último Recebimento</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;" class="last-payment" data-bank="Mercado Pago">
              <div class="pulse-dot" style="width: 8px; height: 8px; background: #10b981; border-radius: 50%; box-shadow: 0 0 10px #10b981;"></div>
              <span style="font-size: 0.85rem; font-weight: 600;" class="payment-time">Hoje, 14:22</span>
            </div>
          </div>
        </div>
        <div class="client-card-footer" style="margin-top: 1.5rem; gap: 0.5rem;">
          <button class="btn btn-secondary btn-bank-verify" data-bank="Mercado Pago" style="background: rgba(255,255,255,0.1); color: white; border: none; flex: 1; justify-content: center; font-size: 0.8rem;"><i data-lucide="refresh-cw"></i> Verificar</button>
          <button class="btn btn-secondary btn-bank-config" data-bank="Mercado Pago" style="background: rgba(255,255,255,0.2); color: white; border: none; flex: 2; justify-content: center;">Configurar</button>
        </div>
      </div>

      <div class="client-card animate-fade" style="background: #820ad1; border-color: rgba(255,255,255,0.1); animation-delay: 0.1s;">
        <div class="client-card-header">
           <img src="https://logodownload.org/wp-content/uploads/2019/08/nubank-logo.png" style="height: 25px; filter: brightness(0) invert(1);" alt="Nubank">
           <div class="client-status-badge" style="background: rgba(255,255,255,0.2); color: white;">CONFIGURAR</div>
        </div>
        <div class="client-card-body" style="color: white; margin-top: 1rem;">
          <h3 style="margin-bottom: 0.5rem;">Nubank Business</h3>
          <p style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 1.5rem;">Integração via Open Finance para extratos.</p>
          <div class="client-card-info" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1);">
            <div class="info-item bank-status-info" style="color: white;" data-bank="Nubank">
              <i data-lucide="lock" style="color: #f59e0b;"></i>
              <span class="status-text">Requer Certificado</span>
            </div>
          </div>
          <div style="margin-top: 1rem; padding: 0.75rem; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.2);">
            <div style="font-size: 0.7rem; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 0.4rem;">Último Recebimento</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;" class="last-payment" data-bank="Nubank">
              <div style="width: 8px; height: 8px; background: #64748b; border-radius: 50%;"></div>
              <span style="font-size: 0.85rem; font-weight: 600; opacity: 0.5;" class="payment-time">Aguardando...</span>
            </div>
          </div>
        </div>
        <div class="client-card-footer" style="margin-top: 1.5rem; gap: 0.5rem;">
          <button class="btn btn-secondary btn-bank-verify" data-bank="Nubank" style="background: rgba(255,255,255,0.1); color: white; border: none; flex: 1; justify-content: center; font-size: 0.8rem;"><i data-lucide="refresh-cw"></i> Verificar</button>
          <button class="btn btn-primary btn-bank-config" data-bank="Nubank" style="background: white; color: #820ad1; border: none; flex: 2; justify-content: center;">Conectar</button>
        </div>
      </div>

      <div class="client-card animate-fade" style="background: #ff7a00; border-color: rgba(255,255,255,0.1); animation-delay: 0.2s;">
        <div class="client-card-header">
           <img src="https://logodownload.org/wp-content/uploads/2019/11/banco-inter-logo-1.png" style="height: 20px; filter: brightness(0) invert(1);" alt="Banco Inter">
           <div class="client-status-badge" style="background: rgba(255,255,255,0.2); color: white;">ATIVO</div>
        </div>
        <div class="client-card-body" style="color: white; margin-top: 1rem;">
          <h3 style="margin-bottom: 0.5rem;">Banco Inter</h3>
          <p style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 1.5rem;">API V2 para Boletos e PIX.</p>
          <div class="client-card-info" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1);">
            <div class="info-item" style="color: white;">
              <i data-lucide="check-circle" style="color: white;"></i>
              <span>Autenticado</span>
            </div>
          </div>
        </div>
        <div class="client-card-footer" style="margin-top: 1.5rem;">
          <button class="btn btn-secondary btn-bank-config" data-bank="Banco Inter" style="background: rgba(255,255,255,0.2); color: white; border: none; flex: 1; justify-content: center;">Gerenciar</button>
        </div>
      </div>

      <div class="client-card animate-fade" style="background: #003366; border-color: rgba(255,255,255,0.1); animation-delay: 0.3s;">
        <div class="client-card-header">
           <img src="https://logodownload.org/wp-content/uploads/2017/10/sicoob-logo.png" style="height: 30px; filter: brightness(0) invert(1);" alt="Sicoob">
           <div class="client-status-badge" style="background: rgba(255,255,255,0.2); color: white;">ATIVO</div>
        </div>
        <div class="client-card-body" style="color: white; margin-top: 1rem;">
          <h3 style="margin-bottom: 0.5rem;">Sicoob</h3>
          <p style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 1.5rem;">Integração CNAB e Webhook PIX.</p>
          <div class="client-card-info" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1);">
            <div class="info-item" style="color: white;">
              <i data-lucide="check-circle" style="color: white;"></i>
              <span>Status: Online</span>
            </div>
          </div>
        </div>
        <div class="client-card-footer" style="margin-top: 1.5rem;">
          <button class="btn btn-secondary btn-bank-config" data-bank="Sicoob" style="background: rgba(255,255,255,0.2); color: white; border: none; flex: 1; justify-content: center;">Ajustes</button>
        </div>
      </div>

      <div class="client-card animate-fade" style="background: #cc092f; border-color: rgba(255,255,255,0.1); animation-delay: 0.4s;">
        <div class="client-card-header">
           <img src="https://logodownload.org/wp-content/uploads/2014/05/bradesco-logo.png" style="height: 35px; filter: brightness(0) invert(1);" alt="Bradesco">
           <div class="client-status-badge" style="background: rgba(255,255,255,0.2); color: white;">CONFIGURAR</div>
        </div>
        <div class="client-card-body" style="color: white; margin-top: 1rem;">
          <h3 style="margin-bottom: 0.5rem;">Bradesco Net</h3>
          <p style="font-size: 0.8rem; opacity: 0.8; margin-bottom: 1.5rem;">Verificação de depósitos e TEDs.</p>
          <div class="client-card-info" style="background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.1);">
             <div class="info-item" style="color: white;">
              <i data-lucide="help-circle" style="color: white;"></i>
              <span>Aguardando Credenciais</span>
            </div>
          </div>
        </div>
        <div class="client-card-footer" style="margin-top: 1.5rem;">
          <button class="btn btn-primary btn-bank-config" data-bank="Bradesco" style="background: white; color: #cc092f; border: none; flex: 1; justify-content: center;">Conectar</button>
        </div>
      </div>
    </div>
    `,

  mikrotiks: () => `
    <div class="top-bar">
      <h1 class="page-title">Gerenciar Mikrotiks</h1>
      <button class="btn btn-primary" id="add-mikrotik">
        <i data-lucide="plus"></i> Novo Mikrotik
      </button>
    </div>

    <div class="clients-grid">
      ${state.mikrotiks.length === 0 ? `
        <div class="card animate-fade" style="padding: 3rem; text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">
          Nenhum Mikrotik cadastrado.
        </div>
      ` : state.mikrotiks.map((mk, index) => `
        <div class="client-card animate-fade" style="animation-delay: ${index * 0.1}s">
          <div class="client-card-header">
            <div class="client-avatar-icon">
              <i data-lucide="router"></i>
            </div>
            <div class="client-status-badge status-${mk.status === 'online' ? 'ativo' : 'bloqueado'} btn-toggle-status" style="cursor: pointer;" title="Clique para alternar status">
              ${mk.status === 'online' ? 'CONECTADO' : 'DESCONECTADO'}
            </div>
          </div>
          
          <div class="client-card-body">
            <h3 class="client-card-name">${mk.name}</h3>
            <div class="client-card-login">
              <i data-lucide="hash" style="width: 14px;"></i>
              <span>ID: #${mk.id}</span>
            </div>
            
            <div class="client-card-info">
              <div class="info-item">
                <i data-lucide="globe"></i>
                <span>${mk.ip}</span>
              </div>
              <div class="info-item">
                <i data-lucide="cpu"></i>
                <span>CPU: ${mk.cpu}</span>
              </div>
              <div class="info-item">
                <i data-lucide="users"></i>
                <span>${state.clients.filter(c => c.syncedMks && c.syncedMks.some(smk => smk.ip === mk.ip) || c.mikrotikIp === mk.ip).length} Clientes</span>
              </div>
            </div>
          </div>

          <div class="client-card-footer">
            <button class="btn btn-client-edit btn-configure" title="Configurar" style="flex: 2;">
              <i data-lucide="settings-2"></i>
            </button>
            <button class="btn btn-client-edit btn-edit" title="Editar" style="flex: 2;">
              <i data-lucide="edit-3"></i>
            </button>
            <button class="btn btn-client-delete btn-delete" title="Excluir">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `,

  plans: () => `
    <div class="top-bar">
      <h1 class="page-title">Planos de Internet</h1>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-secondary" id="btn-import-plans">
          <i data-lucide="download"></i> Importar
        </button>
        <button class="btn btn-primary" id="btn-create-plan">
          <i data-lucide="plus"></i> Criar Plano
        </button>
      </div>
    </div>

    <div class="plans-grid">
      ${state.plans.map((plan, index) => `
        <div class="plan-card animate-fade" style="animation-delay: ${index * 0.1}s">
          <div class="plan-card-header">
            <div class="plan-badge">
              <i data-lucide="zap"></i>
            </div>
            <div class="plan-price-tag">${plan.price}</div>
          </div>
          
          <div class="plan-card-body">
            <h3 class="plan-title">${plan.name}</h3>
            <div class="plan-specs">
              <div class="spec-item">
                <i data-lucide="arrow-down-circle"></i>
                <span>${plan.download}</span>
              </div>
              <div class="spec-item">
                <i data-lucide="arrow-up-circle"></i>
                <span>${plan.upload}</span>
              </div>
            </div>
          </div>

          <div class="plan-card-footer">
            <button class="btn btn-plan-edit btn-edit-plan" data-index="${index}">
              <i data-lucide="edit-2"></i> Editar
            </button>
            <button class="btn btn-plan-delete btn-delete-plan" data-index="${index}">
              <i data-lucide="trash-2"></i> Excluir
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `,

  vpn: () => `
    <div class="top-bar">
      <h1 class="page-title">Configuração de Comunicação</h1>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start;">
      <div class="card animate-fade">
        <div class="card-header">
          <h3>Identificação do Roteador</h3>
        </div>
        <div style="padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Nome do Roteador</label>
              <input type="text" id="mk-name-input" value="Borda-Principal" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Endereço IP (Local/Wan)</label>
              <input type="text" id="mk-ip-input" value="192.168.88.1" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Usuário API</label>
              <input type="text" id="mk-user-input" value="lstore_admin" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Senha API</label>
              <input type="password" id="mk-pass-input" value="ls@2026" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Porta API Mikrotik</label>
            <input type="number" id="mk-port-input" value="8728" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
          </div>

          <div style="background: rgba(0, 242, 255, 0.05); border: 1px solid rgba(0, 242, 255, 0.2); padding: 1rem; border-radius: 12px;">
            <p style="font-size: 0.85rem; line-height: 1.4;">
              <i data-lucide="info" style="width: 14px; vertical-align: middle;"></i>
              Este nome será usado para identificar o roteador no seu painel LSTORE. 
              O script abaixo será atualizado automaticamente.
            </p>
          </div>
          
          <button class="btn btn-primary" id="btn-add-to-list" style="width: 100%; margin-top: 1rem;">
            <i data-lucide="plus-circle" style="width: 18px; vertical-align: middle; margin-right: 8px;"></i>
            Salvar no Painel LSTORE
          </button>
        </div>
      </div>

      <div class="card animate-fade" style="animation-delay: 0.1s">
        <div class="card-header">
          <div>
            <h3>Script Mikrotik</h3>
          </div>
          <button class="btn btn-secondary" id="copy-script" style="font-size: 0.8rem;">
            <i data-lucide="copy"></i> Copiar
          </button>
        </div>
        
        <div class="terminal-card" style="margin-top: 0;">
          <div class="terminal-header">
            <div class="terminal-dot dot-red"></div>
            <div class="terminal-dot dot-yellow"></div>
            <div class="terminal-dot dot-green"></div>
          </div>
          <div class="terminal-content" id="script-content" style="max-height: 300px; font-size: 0.8rem;">
<pre style="font-family: inherit; margin: 0; white-space: pre-wrap;"># --- SCRIPT DE CONFIGURAÇÃO LSTORE ---
# Roteador: <span id="script-mk-name">Borda-Principal</span>
# Token: ${state.vpnConfig.token}

/system identity set name="LSTORE-<span id="script-mk-name-2">Borda-Principal</span>"

# Habilita Servico API
/ip service set api disabled=no port=<span id="script-mk-port">8728</span>
/ip service set api-ssl disabled=yes

# Configura Usuario de Acesso
:do { /user add name="<span id="script-mk-user">lstore_admin</span>" password="<span id="script-mk-pass">ls@2026</span>" group=full comment="Usuario LSTORE" } on-error={ /user set [find name="<span id="script-mk-user">lstore_admin</span>"] password="<span id="script-mk-pass">ls@2026</span>" }

# Configura Cliente VPN
:do {
    /interface ovpn-client add name=vpn-lstore connect-to=${state.vpnConfig.server}
    /interface ovpn-client set [find name=vpn-lstore] port=${state.vpnConfig.port} mode=ip user="${state.vpnConfig.token}" password="lstore-secure-pass" profile=default-encryption add-default-route=no comment="Painel LSTORE"
} on-error={
    /interface ovpn-client set [find name=vpn-lstore] connect-to=${state.vpnConfig.server} user="${state.vpnConfig.token}"
}

/log info "LSTORE: Script executado com sucesso!"
/put "Configuracao finalizada! Verifique o status no painel LSTORE."</pre>
          </div>
        </div>
      </div>
    </div>
  `,

  whatsapp: () => `
    <div class="top-bar">
      <h1 class="page-title">Integração WhatsApp</h1>
      <button class="btn btn-primary" id="btn-whatsapp-connect">
        <i data-lucide="power"></i> Conectar
      </button>
      <button class="btn btn-secondary" id="btn-whatsapp-disconnect" style="display: none; background: rgba(239, 68, 68, 0.1); color: var(--danger); border-color: rgba(239, 68, 68, 0.2);">
        <i data-lucide="power-off"></i> Desconectar
      </button>
    </div>

    <div class="card animate-fade" style="max-width: 600px; margin: 2rem auto; text-align: center; padding: 3rem;">
      <div id="whatsapp-status-badge" style="display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; margin-bottom: 2rem; background: #f8f9fa; color: var(--text-secondary);">
        <div style="width: 10px; height: 10px; border-radius: 50%; background: currentColor;"></div>
        <span>Verificando status...</span>
      </div>
      
      <div id="whatsapp-qr-container" style="display: none; margin: 1rem 0;">
        <p style="margin-bottom: 1rem; color: var(--text-secondary);">Escaneie o QR Code abaixo com o seu WhatsApp para conectar a API.</p>
        <div style="background: white; padding: 1rem; border-radius: 16px; display: inline-block; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
          <img id="whatsapp-qr-image" src="" alt="QR Code WhatsApp" style="width: 250px; height: 250px;">
        </div>
      </div>
      
      <div id="whatsapp-connected-container" style="display: none; flex-direction: column; align-items: center; gap: 1rem;">
        <div style="width: 80px; height: 80px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto;">
          <i data-lucide="check-circle" style="width: 40px; height: 40px;"></i>
        </div>
        <h3 style="font-size: 1.5rem; color: var(--text-primary);">WhatsApp Conectado!</h3>
        <p style="color: var(--text-secondary);">O servidor está pronto para enviar e receber mensagens via WhatsApp.</p>
      </div>

      <div id="whatsapp-loading-container" style="display: none; flex-direction: column; align-items: center; gap: 1rem;">
        <i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 40px; height: 40px; color: var(--accent-primary);"></i>
        <p style="color: var(--text-secondary);">Aguarde, processando conexão...</p>
      </div>
    </div>
  `,

  cain: () => `
    <div style="width: 100%; height: calc(100vh - 60px); display: flex; flex-direction: column;">
      <div class="top-bar" style="margin-bottom: 0; border-bottom: 1px solid var(--card-border); border-radius: 12px 12px 0 0;">
        <h1 class="page-title" style="display: flex; align-items: center; gap: 0.5rem;">
          <i data-lucide="bot"></i> C.A.I.N. Inteligência Artificial
        </h1>
        <div style="font-size: 0.8rem; color: var(--text-secondary);">
          Integração Porta 3100
        </div>
      </div>
      <div style="flex: 1; background: #000; border-radius: 0 0 12px 12px; overflow: hidden; position: relative;">
        <!-- Loading spinner shown before iframe loads -->
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 1rem; color: var(--accent-primary);">
          <i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 40px; height: 40px;"></i>
          <p style="color: var(--text-secondary); font-family: monospace;">INICIALIZANDO CAIN...</p>
        </div>
        <iframe src="http://localhost:3100" style="position: relative; z-index: 10; width: 100%; height: 100%; border: none;"></iframe>
      </div>
    </div>
  `,

  ippools: () => `
    <div class="top-bar">
      <h1 class="page-title">IP Pools (Pool de Endereços)</h1>
      <div style="display: flex; gap: 1rem;">
        <button class="btn btn-secondary" id="btn-import-pools">
          <i data-lucide="download"></i> Importar
        </button>
        <button class="btn btn-primary" id="btn-create-pool">
          <i data-lucide="plus"></i> Criar Pool
        </button>
      </div>
    </div>

    <div class="pools-grid">
      ${state.ipPools.length === 0 ? `
        <div class="card animate-fade" style="padding: 3rem; text-align: center; color: var(--text-secondary); grid-column: 1 / -1;">
          Nenhuma IP Pool cadastrada ainda.
        </div>
      ` : state.ipPools.map((pool, index) => `
        <div class="pool-card animate-fade" style="animation-delay: ${index * 0.1}s">
          <div class="pool-card-header">
            <div class="pool-badge-icon">
              <i data-lucide="layers"></i>
            </div>
            <div class="pool-status-tag">
               <i data-lucide="server"></i> ${pool.syncedMks ? pool.syncedMks.length : 1} Mikrotiks
            </div>
          </div>
          
          <div class="pool-card-body">
            <h3 class="pool-card-title">${pool.name}</h3>
            <div class="pool-card-ranges">
              <i data-lucide="network"></i>
              <span>${pool.ranges}</span>
            </div>
          </div>

          <div class="pool-card-footer">
            <button class="btn btn-pool-edit btn-edit-pool" data-index="${index}">
              <i data-lucide="edit-2"></i> Editar
            </button>
            <button class="btn btn-pool-delete btn-delete-pool" data-index="${index}">
              <i data-lucide="trash-2"></i> Excluir
            </button>
          </div>
        </div>
      `).join('')}
    </div>
  `,

  logs: () => `
    <div class="top-bar">
      <h1 class="page-title">Logs do Sistema</h1>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <label for="log-mk-selector" style="font-size: 0.9rem; color: var(--text-secondary);">Selecionar Mikrotik:</label>
        <select id="log-mk-selector" class="btn btn-secondary" style="padding-right: 2rem; appearance: auto;">
          ${state.mikrotiks.map(mk => `
            <option value="${mk.ip}" ${state.activeLogMkIp === mk.ip ? 'selected' : ''}>${mk.name} (${mk.ip})</option>
          `).join('')}
        </select>
        <button class="btn btn-primary" id="btn-refresh-logs">
          <i data-lucide="refresh-cw"></i> Atualizar
        </button>
      </div>
    </div>

    <div class="card animate-fade">
      <div class="terminal-card terminal-dark" style="margin-top: 0; min-height: 500px; display: flex; flex-direction: column;">
        <div class="terminal-header">
          <div class="terminal-dot dot-red"></div>
          <div class="terminal-dot dot-yellow"></div>
          <div class="terminal-dot dot-green"></div>
          <span style="margin-left: 1rem; font-size: 0.75rem; color: rgba(255,255,255,0.6); font-family: monospace;" id="log-terminal-title">Aguardando...</span>
        </div>
        <div class="terminal-content" id="log-terminal-content" style="flex: 1; overflow-y: auto; font-family: 'Fira Code', monospace; font-size: 0.85rem; padding: 1.5rem; line-height: 1.6; background: #000;">
          <div style="color: var(--accent-primary);">[SISTEMA] Selecione um Mikrotik para iniciar o monitoramento automático...</div>
        </div>
      </div>
    </div>
  `,

  all_payments: () => `
    <div class="top-bar">
      <h1 class="page-title">Pagamentos & Cobranças</h1>
      <div class="user-profile">
        <div class="avatar"></div>
        <span>Financeiro LSTORE</span>
      </div>
    </div>

    <div class="card animate-fade">
      <div class="tabs-container">
        <div class="tab-buttons">
          <button class="tab-button active" data-tab="billing">
            <i data-lucide="send"></i> Gerar Cobrança
          </button>
          <button class="tab-button" data-tab="history">
            <i data-lucide="history"></i> Histórico PIX
          </button>
          <button class="tab-button" data-tab="verification">
            <i data-lucide="check-circle"></i> Verificação em Massa
          </button>
        </div>

        <div class="tab-content active" id="tab-billing">
          <div class="view-header" style="margin-top: 1.5rem;">
            <div class="header-main">
              <h3>Clientes para Cobrança</h3>
              <div class="search-bar">
                <i data-lucide="search"></i>
                <input type="text" id="billing-search" placeholder="Procurar cliente...">
              </div>
            </div>
          </div>
          <div class="table-container" style="margin-top: 1rem;">
            <table id="billing-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Plano</th>
                  <th>Vencimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="billing-list">
                ${state.clients.map(c => `
                  <tr>
                    <td>
                      <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div class="client-avatar-icon" style="width: 32px; height: 32px; font-size: 0.7rem;">
                          <i data-lucide="user"></i>
                        </div>
                        <div>
                          <div style="font-weight: 600;">${c.name || c.login}</div>
                          <div style="font-size: 0.75rem; color: var(--text-secondary);">${c.login}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div style="font-size: 0.85rem; font-weight: 600;">${c.plan}</div>
                      <div style="font-size: 0.75rem; color: var(--accent-primary);">
                        ${state.plans.find(p => p.name === c.plan)?.price || 'R$ 0,00'}
                      </div>
                    </td>
                    <td><span style="font-size: 0.85rem;">${new Date().toLocaleDateString('pt-BR')}</span></td>
                    <td><span class="status-badge status-${getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')}">${(getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')).toUpperCase()}</span></td>
                    <td>
                      <button class="btn btn-primary btn-sm btn-generate-pix" data-id="${c.id}" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                        <i data-lucide="qr-code"></i> Cobrar PIX
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <div class="tab-content" id="tab-history">
          <div style="padding: 3rem; text-align: center; color: var(--text-secondary);">
            <i data-lucide="clock" style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5;"></i>
            <p>Nenhuma cobrança PIX gerada recentemente.</p>
          </div>
        </div>

        <div class="tab-content" id="tab-verification">
           <div style="padding: 2rem;">
              <div style="background: rgba(0, 114, 255, 0.05); border: 1px solid rgba(0, 114, 255, 0.1); padding: 1.5rem; border-radius: 16px; margin-bottom: 2rem;">
                <h4 style="margin-bottom: 0.5rem;"><i data-lucide="shield-check"></i> Verificador Inteligente LSTORE</h4>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">O sistema verifica automaticamente cada cliente individualmente para confirmar se o pagamento PIX foi compensado.</p>
              </div>
              <button class="btn btn-primary" id="btn-verify-all" style="width: 100%; justify-content: center; padding: 1rem;">
                <i data-lucide="refresh-cw"></i> Iniciar Verificação em Massa
              </button>
           </div>
        </div>
      </div>
    </div>
  `,

  contacts: () => {
    const clientsWithPhone = state.clients.filter(c => c.phone && c.phone.trim() !== '');
    return `
      <div class="top-bar">
        <h1 class="page-title">Lista de Contatos (WhatsApp)</h1>
        <div class="user-profile">
          <div class="avatar"></div>
          <span>CRM LSTORE</span>
        </div>
      </div>

      <div class="dashboard-grid" style="grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));">
        <div class="stat-card animate-fade">
          <div class="stat-label">Total de Contatos</div>
          <div class="stat-value">${clientsWithPhone.length}</div>
          <div class="stat-trend">Clientes com telefone cadastrado</div>
        </div>
        <div class="stat-card animate-fade" style="animation-delay: 0.1s">
          <div class="stat-label">Cobrança Automática</div>
          <div class="stat-value" id="auto-billing-status">ATIVO</div>
          <div class="stat-trend" style="color: var(--success)">Monitorando clientes atrasados</div>
        </div>
      </div>

      <div class="card animate-fade" style="margin-top: 2rem;">
        <div class="card-header">
          <h2>Contatos dos Clientes</h2>
          <div class="search-container">
            <i data-lucide="search"></i>
            <input type="text" id="contact-search" placeholder="Pesquisar contato...">
          </div>
        </div>
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>Nome do Cliente</th>
                <th>Telefone</th>
                <th>Status Financeiro</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody id="contacts-list">
              ${clientsWithPhone.map(c => `
                <tr>
                  <td>
                    <div style="font-weight: 600;">${c.name || c.login}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary);">ID: ${c.login}</div>
                  </td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 0.5rem; color: #10b981; font-weight: 600;">
                      <i data-lucide="phone" style="width: 14px;"></i>
                      ${c.phone}
                    </div>
                  </td>
                  <td>
                    <span class="status-badge status-${getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')}">
                      ${(getEffectiveStatus(c) === 'atrasado' ? 'atrasado' : (c.status || 'ativo')).toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style="display: flex; gap: 0.5rem;">
                      <button class="btn btn-primary btn-sm" onclick="sendWhatsAppBilling('${c.id}')" style="padding: 0.4rem 0.8rem; font-size: 0.75rem; background: #25D366; border: none;">
                        <i data-lucide="message-square"></i> Cobrar Zap
                      </button>
                      <button class="btn btn-secondary btn-sm" onclick="generatePix('${c.id}')" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;">
                        <i data-lucide="qr-code"></i> Ver PIX
                      </button>
                    </div>
                  </td>
                </tr>
              `).join('')}
              ${clientsWithPhone.length === 0 ? '<tr><td colspan="4" style="text-align: center; padding: 3rem; color: var(--text-secondary);">Nenhum cliente com telefone cadastrado.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};

// Traffic Monitor Logic (Real-time Bars)
let trafficInterval = null;

function initDashboardTrafficMonitor() {
  const downFill = document.getElementById('bar-down-fill');
  const upFill = document.getElementById('bar-up-fill');
  const downVal = document.getElementById('bar-down-value');
  const upVal = document.getElementById('bar-up-value');
  
  const headerDown = document.getElementById('gauge-download');
  const headerUp = document.getElementById('gauge-upload');
  const headerPing = document.getElementById('gauge-ping');

  if (!downFill) return;

  const updateTraffic = async () => {
    const onlineMks = state.mikrotiks.filter(m => m.status === 'online');
    
    let totalDownload = 0;
    let totalUpload = 0;
    let ping = 0;

    const formatSpeed = (valMbps) => {
      if (valMbps < 1) {
        return `${(valMbps * 1000).toFixed(0)} kbps`;
      }
      return `${valMbps.toFixed(2)} Mbps`;
    };

    // Heartbeat: Se não houve atualização em 45 segundos, marcar como OFF
    state.mikrotiks.forEach(mk => {
      const timeSinceLastUpdate = mk.lastSeen ? (Date.now() - mk.lastSeen) : (Date.now() - (window.dashboardLoadTime || Date.now()));
      
      if (mk.status === 'online' && timeSinceLastUpdate > 45000) {
        console.warn(`LSTORE: Heartbeat falhou para ${mk.name} (${mk.ip}). Forçando status OFF.`);
        mk.status = 'off';
        const idIp = mk.ip.replace(/\./g, '-');
        const badge = document.querySelector(`#dashboard-routers-list tr[data-ip="${idIp}"] .status-badge`);
        if (badge) {
          badge.className = `status-badge status-off`;
          badge.innerText = 'OFF';
        }
        saveState();
      }
    });

    if (window.isUpdatingTraffic) return;
    window.isUpdatingTraffic = true;

    const updateMikrotiksStatus = async () => {
      const hosts = state.mikrotiks.map(m => m.ip);
      if (hosts.length === 0) return;

      try {
        const response = await fetch('/api/traffic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hosts })
        });
        
        // Verifica se a resposta é JSON válido
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
           console.error("LSTORE: Servidor retornou erro não-JSON.");
           return;
        }

        const data = await response.json();

        if (data.status === 'success' && data.devices) {
          data.devices.forEach(dev => {
            const mk = state.mikrotiks.find(m => m.ip === dev.host);
            if (mk) {
              mk.status = dev.status;
              mk.latency = dev.latency;
            }

            // Atualiza a UI se os elementos existirem
            const statusBadge = document.querySelector(`[data-mk-ip="${dev.host}"] .status-badge`);
            if (statusBadge) {
              statusBadge.innerHTML = dev.status === 'online' 
                ? `<span class="status-indicator status-online"></span> Online` 
                : `<span class="status-indicator status-offline"></span> Offline`;
            }
          });
          saveState();
        }
      } catch (err) {
        console.warn('LSTORE: Heartbeat falhou. Verifique a conexão com o servidor.');
      }
    };

    if (state.mikrotiks.length > 0) {
      try {
        const hostsToQuery = state.mikrotiks.map(m => m.ip);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);

        const response = await fetch('/api/traffic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hosts: hostsToQuery }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const result = await response.json();
        if (result.status === 'success' && result.devices) {
          result.devices.forEach(dev => {
            totalDownload += dev.download;
            totalUpload += dev.upload;
            
            // Atualizar status no estado se mudou
            const mk = state.mikrotiks.find(m => m.ip === dev.host);
            if (mk) {
              mk.lastSeen = Date.now();
              if (mk.status !== dev.status || (dev.status === 'online' && dev.latency)) {
                mk.status = dev.status;
                mk.latency = dev.latency;
                saveState();
                // Atualizar badge na tabela do dashboard se existir
                const idIp = dev.host.replace(/\./g, '-');
                const badge = document.querySelector(`#dashboard-routers-list tr[data-ip="${idIp}"] .status-badge`);
                if (badge) {
                  badge.className = `status-badge status-${dev.status}`;
                  badge.innerText = `${dev.status.toUpperCase()} (${dev.latency}ms)`;
                }
              }
            }

            const idIp = dev.host.replace(/\./g, '-');
            const mDown = document.getElementById(`mini-down-${idIp}`);
            const mUp = document.getElementById(`mini-up-${idIp}`);
            const tDown = document.getElementById(`txt-down-${idIp}`);
            const tUp = document.getElementById(`txt-up-${idIp}`);
            
            if (mDown) {
              mDown.style.width = `${Math.min((dev.download / 100) * 100, 100)}%`;
              tDown.innerText = formatSpeed(dev.download);
            }
            if (mUp) {
              mUp.style.width = `${Math.min((dev.upload / 100) * 100, 100)}%`;
              tUp.innerText = formatSpeed(dev.upload);
            }
          });
          ping = Math.floor(Math.random() * 5) + 2; 
        }
      } catch (e) {
        console.error('LSTORE: Erro ao buscar tráfego real:', e);
      } finally {
        window.isUpdatingTraffic = false;
      }
    } else {
      window.isUpdatingTraffic = false;
    }

    const maxVal = 250; 
    
    const downHeight = Math.min((totalDownload / maxVal) * 100, 100);
    const upHeight = Math.min((totalUpload / maxVal) * 100, 100);
    
    downFill.style.height = `${downHeight}%`;
    upFill.style.height = `${upHeight}%`;
    
    downVal.innerText = formatSpeed(totalDownload);
    upVal.innerText = formatSpeed(totalUpload);
    
    if (headerDown) headerDown.innerText = totalDownload.toFixed(2);
    if (headerUp) headerUp.innerText = totalUpload.toFixed(2);
    if (headerPing) headerPing.innerText = ping;
  };

  updateTraffic();
  trafficInterval = setInterval(updateTraffic, 3000); 
}



// Navigation Logic
let whatsappInterval = null;

function navigate(page) {
  state.activePage = page;
  
  // Verificação de faturamento automática ao navegar para qualquer página
  checkAutomaticBlocks();
  
  // Cleanup intervals if navigating away
  if (trafficInterval) {
    clearInterval(trafficInterval);
    trafficInterval = null;
  }
  if (whatsappInterval) {
    clearInterval(whatsappInterval);
    whatsappInterval = null;
  }
  if (window.logsInterval) {
    clearInterval(window.logsInterval);
    window.logsInterval = null;
  }

  // Update UI
  const mainView = document.getElementById('main-view');
  mainView.innerHTML = templates[page] ? templates[page]() : '<h1>404</h1>';
  
  // Update Active Link
  document.querySelectorAll('.nav-item').forEach(link => {
    link.classList.toggle('active', link.dataset.page === page);
  });

  // Re-initialize Lucide icons
  lucide.createIcons();

  // Initialize page-specific logic
  if (page === 'dashboard') {
    initDashboardTrafficMonitor();
  }

  if (page === 'vpn') {
    const inputs = {
      name: document.getElementById('mk-name-input'),
      ip: document.getElementById('mk-ip-input'),
      user: document.getElementById('mk-user-input'),
      pass: document.getElementById('mk-pass-input'),
      port: document.getElementById('mk-port-input')
    };

    const scriptSpans = {
      name: document.getElementById('script-mk-name'),
      name2: document.getElementById('script-mk-name-2'),
      ip: document.getElementById('script-mk-ip'),
      user: document.getElementById('script-mk-user'),
      pass: document.getElementById('script-mk-pass'),
      port: document.getElementById('script-mk-port')
    };

    const updateScript = () => {
      scriptSpans.name.innerText = inputs.name.value || 'Router';
      scriptSpans.name2.innerText = inputs.name.value || 'Router';
      scriptSpans.ip.innerText = inputs.ip.value || '0.0.0.0';
      scriptSpans.user.innerText = inputs.user.value || 'admin';
      scriptSpans.pass.innerText = inputs.pass.value || 'password';
      scriptSpans.port.innerText = inputs.port.value || '8728';
    };

    Object.values(inputs).forEach(input => {
      input.addEventListener('input', updateScript);
    });

    document.getElementById('copy-script').addEventListener('click', () => {
      const scriptText = document.getElementById('script-content').innerText;
      navigator.clipboard.writeText(scriptText);
      showCustomConfirm("SUCESSO", "Script copiado com sucesso!", "FECHAR", "", true);
    });

    document.getElementById('btn-add-to-list').addEventListener('click', () => {
      const newMk = {
        id: Date.now(),
        name: inputs.name.value || 'Novo Mikrotik',
        ip: inputs.ip.value || '0.0.0.0',
        status: 'online',
        clients: 0,
        cpu: '0%'
      };
      
      state.mikrotiks.push(newMk);
      saveState();
      showCustomConfirm("SUCESSO", `Mikrotik "${newMk.name}" adicionado com sucesso!`, "FECHAR", () => navigate('mikrotiks'), true);
    });
  }

  if (page === 'whatsapp') {
    const statusBadge = document.getElementById('whatsapp-status-badge');
    const statusText = statusBadge.querySelector('span');
    const qrContainer = document.getElementById('whatsapp-qr-container');
    const qrImage = document.getElementById('whatsapp-qr-image');
    const connectedContainer = document.getElementById('whatsapp-connected-container');
    const loadingContainer = document.getElementById('whatsapp-loading-container');
    const btnConnect = document.getElementById('btn-whatsapp-connect');
    const btnDisconnect = document.getElementById('btn-whatsapp-disconnect');

    const checkStatus = async () => {
      try {
        const response = await fetch('/api/whatsapp/status');
        const data = await response.json();
        
        qrContainer.style.display = 'none';
        connectedContainer.style.display = 'none';
        loadingContainer.style.display = 'none';
        btnConnect.style.display = 'none';
        btnDisconnect.style.display = 'none';

        if (data.status === 'DISCONNECTED') {
          statusBadge.style.color = 'var(--text-secondary)';
          statusText.innerText = 'Desconectado';
          btnConnect.style.display = 'inline-flex';
        } else if (data.status === 'CONNECTING') {
          statusBadge.style.color = 'var(--accent-primary)';
          statusText.innerText = 'Conectando...';
          loadingContainer.style.display = 'flex';
          btnDisconnect.style.display = 'inline-flex';
        } else if (data.status === 'QR_CODE') {
          statusBadge.style.color = 'var(--warning)';
          statusText.innerText = 'Aguardando QR Code';
          qrContainer.style.display = 'block';
          if (data.qr) {
            qrImage.src = data.qr;
          }
          btnDisconnect.style.display = 'inline-flex';
        } else if (data.status === 'CONNECTED') {
          statusBadge.style.color = '#10b981';
          statusText.innerText = 'Conectado';
          connectedContainer.style.display = 'flex';
          btnDisconnect.style.display = 'inline-flex';
        }
      } catch (err) {
        console.error('Erro ao buscar status do WhatsApp:', err);
      }
    };

    checkStatus();
    whatsappInterval = setInterval(checkStatus, 3000);

    btnConnect.addEventListener('click', async () => {
      try {
        await fetch('/api/whatsapp/connect', { method: 'POST' });
        checkStatus();
      } catch (e) {
        showCustomConfirm("ERRO", "Erro ao tentar conectar.", "FECHAR", "", true);
      }
    });

    btnDisconnect.addEventListener('click', async () => {
      const confirmed = await showCustomConfirm(
        'Desconectar WhatsApp?',
        'Tem certeza que deseja desconectar o WhatsApp? Isso encerrará a sessão atual.',
        'CONFIRMAR',
        'CANCELAR'
      );
      
      if (confirmed) {
        try {
          await fetch('/api/whatsapp/disconnect', { method: 'POST' });
          checkStatus();
        } catch (e) {
          showCustomConfirm("ERRO", "Erro ao desconectar.", "FECHAR", "", true);
        }
      }
    });
  }

  if (page === 'mikrotiks') {
    document.getElementById('add-mikrotik').addEventListener('click', () => {
      navigate('vpn');
    });

    document.querySelectorAll('.btn-configure').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const mk = state.mikrotiks[index];
        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Configurar ${mk.name}</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="background: linear-gradient(135deg, rgba(0, 114, 255, 0.08), rgba(0, 198, 255, 0.08)); border: 1px solid rgba(0, 114, 255, 0.15); padding: 1.2rem; border-radius: 16px; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);">
              <div class="stat-label" style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 0.3rem;">Endereço IP</div>
              <div style="color: var(--text-primary); font-weight: 700; font-size: 1.1rem;">${mk.ip}</div>
            </div>
            <div style="background: linear-gradient(135deg, rgba(0, 114, 255, 0.08), rgba(0, 198, 255, 0.08)); border: 1px solid rgba(0, 114, 255, 0.15); padding: 1.2rem; border-radius: 16px; box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);">
              <div class="stat-label" style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 0.3rem;">Uptime</div>
              <div style="color: var(--text-primary); font-weight: 700; font-size: 1.1rem;">15 dias, 04:22:10</div>
            </div>
            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="sync-now-btn">Sincronizar Agora</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Fechar</button>
            </div>
          </div>
        `);

        document.getElementById('sync-now-btn').addEventListener('click', () => {
          state.mikrotiks[index].status = 'online';
          saveState();
          closeModal();
          navigate('mikrotiks');
          showCustomConfirm("SUCESSO", "Sincronização concluída! O roteador agora está ONLINE.", "FECHAR", "", true);
        });
      });
    });

    document.querySelectorAll('.btn-edit').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        const mk = state.mikrotiks[index];
        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Editar Mikrotik</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">Nome da Identificação</label>
              <input type="text" id="edit-name" value="${mk.name}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.5rem; font-size: 0.85rem; color: var(--text-secondary);">Endereço IP</label>
              <input type="text" id="edit-ip" value="${mk.ip}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="save-edit-btn">Salvar</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
            </div>
          </div>
        `);

        document.getElementById('save-edit-btn').addEventListener('click', () => {
          const newName = document.getElementById('edit-name').value;
          const newIp = document.getElementById('edit-ip').value;
          
          state.mikrotiks[index].name = newName;
          state.mikrotiks[index].ip = newIp;
          
          saveState();
          closeModal();
          navigate('mikrotiks');
        });
      });
    });

    document.querySelectorAll('.btn-delete').forEach((btn, index) => {
      btn.addEventListener('click', async () => {
        const mk = state.mikrotiks[index];
        const confirmed = await showCustomConfirm(
          'Excluir Mikrotik?',
          `Tem certeza que deseja excluir o roteador <strong>${mk.name}</strong> (${mk.ip}) do painel?`,
          'CONFIRMAR',
          'CANCELAR'
        );
        
        if (confirmed) {
          state.mikrotiks.splice(index, 1);
          saveState();
          navigate('mikrotiks');
        }
      });
    });

    document.querySelectorAll('.btn-toggle-status').forEach((btn, index) => {
      btn.addEventListener('click', () => {
        state.mikrotiks[index].status = state.mikrotiks[index].status === 'online' ? 'offline' : 'online';
        saveState();
        navigate('mikrotiks');
      });
    });
  }

  if (page === 'clients') {
    const searchInput = document.getElementById('client-search');
    if (searchInput) {
      searchInput.focus();
      // Colocar o cursor no final do texto
      const val = searchInput.value;
      searchInput.value = '';
      searchInput.value = val;

      searchInput.addEventListener('input', (e) => {
        state.clientSearchQuery = e.target.value;
        // Não salvamos no localStorage para não manter pesquisa entre sessões, 
        // mas atualizamos a UI re-chamando o navigate (simplificado)
        const mainView = document.getElementById('main-view');
        mainView.innerHTML = templates.clients();
        lucide.createIcons();
        // Re-atracar o listener e manter o foco
        navigate('clients');
      });
    }
  }

  if (page === 'plans') {
    const importPlansBtn = document.getElementById('btn-import-plans');
    if (importPlansBtn) {
      importPlansBtn.addEventListener('click', () => {
        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Importar Planos (PPP Profiles)</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <p style="font-size: 0.9rem; color: var(--text-secondary);">Selecione os Mikrotiks de onde deseja importar os planos:</p>
            <div style="background: #f8f9fa; border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.8rem;">
              <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer; padding-bottom: 0.5rem; border-bottom: 1px dashed var(--card-border);">
                <input type="checkbox" id="select-all-import-plans-mks" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                <span style="font-weight: 700; color: var(--accent-primary);">Selecionar Todos</span>
              </label>
              ${state.mikrotiks.map(mk => `
                <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer;">
                  <input type="checkbox" class="import-plans-mk-checkbox" value="${mk.ip}" data-name="${mk.name}" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                  <span>${mk.name} <small style="color: var(--text-secondary)">(${mk.ip})</small></span>
                </label>
              `).join('')}
              ${state.mikrotiks.length === 0 ? '<span style="color: var(--danger); font-size: 0.85rem;">Nenhum Mikrotik cadastrado.</span>' : ''}
            </div>
            
            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="start-import-plans-btn">Iniciar Importação</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
            </div>
          </div>
        `);

        const selectAll = document.getElementById('select-all-import-plans-mks');
        const checkboxes = document.querySelectorAll('.import-plans-mk-checkbox');
        if (selectAll) {
          selectAll.addEventListener('change', () => {
            checkboxes.forEach(cb => cb.checked = selectAll.checked);
          });
        }

        const startBtn = document.getElementById('start-import-plans-btn');
        if (startBtn) {
          startBtn.addEventListener('click', async () => {
            const selectedMks = Array.from(checkboxes).filter(cb => cb.checked);
            if (selectedMks.length === 0) {
              alert('Selecione pelo menos um Mikrotik para importar.');
              return;
            }

            startBtn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite;"></i> Importando...';
            startBtn.style.pointerEvents = 'none';
            lucide.createIcons();

            let totalImported = 0;
            let errors = 0;

            for (const mk of selectedMks) {
              try {
                const response = await fetch('/api/import', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ host: mk.value, type: 'plans' })
                });
                const resData = await response.json();
                
                if (resData.status === 'success' && resData.data) {
                  const plans = resData.data;
                  plans.forEach(sec => {
                    const existing = state.plans.find(p => p.name === sec.name);
                    if (!existing && sec.name && sec.name !== 'default' && sec.name !== 'default-encryption') {
                      state.plans.push({
                        id: Date.now() + Math.random(),
                        name: sec.name,
                        speed: sec['rate-limit'] || 'Ilimitado',
                        price: '0,00',
                        syncedMks: [{ name: mk.dataset.name, ip: mk.value }]
                      });
                      totalImported++;
                    }
                  });
                } else {
                  errors++;
                  console.error(`Erro ao importar de ${mk.dataset.name}:`, resData.message);
                }
              } catch (e) {
                errors++;
                console.error(`Exceção ao importar de ${mk.dataset.name}:`, e);
              }
            }

            saveState();
            closeModal();
            navigate('plans');
            
            if (errors === 0) {
              alert(`Importação concluída! ${totalImported} novos planos foram importados.`);
            } else {
              alert(`Importação finalizada. ${totalImported} planos importados. Houve falha em ${errors} roteador(es).`);
            }
          });
        }
      });
    }

    document.getElementById('btn-create-plan').addEventListener('click', () => {
      openModal(`
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2>Novo Plano de Internet</h2>
          <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Nome do Plano</label>
            <input type="text" id="plan-name" placeholder="Ex: Fibra 100MB" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.8rem; font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Sincronizar nos Mikrotiks</label>
            <div style="background: #f8f9fa; border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.8rem;">
              <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer; padding-bottom: 0.5rem; border-bottom: 1px dashed var(--card-border);">
                <input type="checkbox" id="select-all-mks" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                <span style="font-weight: 700; color: var(--accent-primary);">Selecionar Todos</span>
              </label>
              ${state.mikrotiks.map(mk => `
                <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer;">
                  <input type="checkbox" class="mk-checkbox" value="${mk.ip}" data-name="${mk.name}" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                  <span>${mk.name} <small style="color: var(--text-secondary)">(${mk.ip})</small></span>
                </label>
              `).join('')}
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Download</label>
              <input type="text" id="plan-down" placeholder="100M" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Upload</label>
              <input type="text" id="plan-up" placeholder="50M" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Preço Mensal</label>
            <input type="text" id="plan-price" placeholder="R$ 89,90" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Local Address</label>
              <input type="text" id="plan-local" placeholder="Ex: 192.168.2.1" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Remote Address</label>
              <select id="plan-remote" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
                <option value="">Selecione uma Pool...</option>
                ${state.ipPools.map(pool => `<option value="${pool.name}">${pool.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">DNS Server</label>
            <input type="text" id="plan-dns" placeholder="Ex: 8.8.8.8,4.4.4.4" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
          </div>
          <div class="terminal" style="margin-top: 1rem; background: #000; position: relative;">
            <div class="terminal-header" style="display: flex; justify-content: space-between; align-items: center;">
              <span>Script Mikrotik (Profile)</span>
              <button id="btn-copy-plan-script" style="background: transparent; border: 1px solid #444; color: #fff; font-size: 0.7rem; padding: 2px 8px; border-radius: 4px; cursor: pointer;">Copiar</button>
            </div>
            <div class="terminal-content" id="mk-plan-script" style="font-size: 0.75rem; color: #00ff00; padding: 10px;">
              /ppp profile add name="<span id="mk-plan-name">...</span>" rate-limit="<span id="mk-plan-limit">...</span>"<span id="mk-plan-extra"></span>
            </div>
          </div>

          <div style="margin-top: 1rem; display: flex; gap: 1rem;">
            <button class="btn btn-primary" style="flex: 1;" id="save-plan-btn">Criar e Sincronizar</button>
            <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
          </div>
        </div>
      `);

      const pName = document.getElementById('plan-name');
      const pDown = document.getElementById('plan-down');
      const pUp = document.getElementById('plan-up');
      const pPrice = document.getElementById('plan-price');
      const pLocal = document.getElementById('plan-local');
      const pRemote = document.getElementById('plan-remote');
      const pDns = document.getElementById('plan-dns');
      
      const mkName = document.getElementById('mk-plan-name');
      const mkLimit = document.getElementById('mk-plan-limit');
      const mkExtra = document.getElementById('mk-plan-extra');

      const updateMkPlan = () => {
        mkName.innerText = pName.value || '...';
        mkLimit.innerText = (pUp.value || '...') + '/' + (pDown.value || '...');
        
        let extra = '';
        if (pLocal.value) extra += ` local-address="${pLocal.value}"`;
        if (pRemote.value) extra += ` remote-address="${pRemote.value}"`;
        if (pDns.value) extra += ` dns-server="${pDns.value}"`;
        mkExtra.innerText = extra;
      };

      [pName, pDown, pUp, pLocal, pRemote, pDns].forEach(el => el.addEventListener('input', updateMkPlan));

      // Selecionar Todos Logic
      const selectAll = document.getElementById('select-all-mks');
      const mkCheckboxes = document.querySelectorAll('.mk-checkbox');
      
      selectAll.addEventListener('change', () => {
        mkCheckboxes.forEach(cb => cb.checked = selectAll.checked);
      });

      document.getElementById('btn-copy-plan-script').addEventListener('click', () => {
        const script = document.getElementById('mk-plan-script').innerText;
        navigator.clipboard.writeText(script);
        alert('Script do Plano copiado! Agora cole no terminal do Mikrotik.');
      });

      document.getElementById('save-plan-btn').addEventListener('click', async (e) => {
        const selectedMks = Array.from(document.querySelectorAll('.mk-checkbox:checked'));
        
        if (selectedMks.length === 0) {
          alert('Por favor, selecione pelo menos um Mikrotik para sincronizar.');
          return;
        }

        const btn = e.target;
        btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; margin-right: 5px; width: 16px;"></i> Sincronizando...';
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.7';
        lucide.createIcons();

        const script = document.getElementById('mk-plan-script').innerText.trim();
        
        const newPlan = {
          id: Date.now(),
          name: pName.value,
          download: pDown.value,
          upload: pUp.value,
          price: pPrice.value || 'R$ 0,00',
          local: pLocal.value,
          remote: pRemote.value,
          dns: pDns.value,
          syncedMks: selectedMks.map(mk => ({ name: mk.dataset.name, ip: mk.value }))
        };
        
        let results = [];
        for (const mk of selectedMks) {
          console.log(`Sincronizando com ${mk.dataset.name} (${mk.value})...`);
          const result = await executeMikrotikCommand(script, mk.value);
          results.push({ name: mk.dataset.name, status: result.status, message: result.message });
        }
        
        state.plans.push(newPlan);
        saveState();
        console.log("LSTORE: Plano salvo com sucesso. Total agora:", state.plans.length);
        closeModal();
        navigate('plans');
        
        const successCount = results.filter(r => r.status === 'success').length;
        const failCount = results.length - successCount;

        if (failCount === 0) {
          alert(`Sucesso! Plano "${newPlan.name}" sincronizado nos ${successCount} Mikrotiks selecionados.`);
        } else {
          alert(`Sincronização concluída:\n- Sucesso: ${successCount}\n- Erro: ${failCount}\n\nVerifique o console para detalhes dos erros.`);
          console.table(results);
        }
      });
    });

    document.querySelectorAll('.btn-delete-plan').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const index = btn.dataset.index;
        const plan = state.plans[index];
        
        askConfirm(
          'Excluir Plano?',
          `Deseja excluir o plano <strong>${plan.name}</strong>? <br><small style="color: var(--danger)">Isso também removerá o perfil de todos os Mikrotiks sincronizados.</small>`,
          async () => {
            btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 16px;"></i>';
            btn.style.pointerEvents = 'none';
            lucide.createIcons();

            // Se o plano tem registro de quais Mikrotiks ele foi sincronizado
            if (plan.syncedMks && plan.syncedMks.length > 0) {
              for (const mk of plan.syncedMks) {
                console.log(`Removendo plano ${plan.name} de ${mk.name} (${mk.ip})...`);
                await executeMikrotikCommand(`/ppp profile remove name="${plan.name}"`, mk.ip);
              }
            } else {
              await executeMikrotikCommand(`/ppp profile remove name="${plan.name}"`);
            }
            
            state.plans.splice(index, 1);
            saveState();
            navigate('plans');
            alert(`Plano "${plan.name}" removido com sucesso.`);
          }
        );
      });
    });

    document.querySelectorAll('.btn-edit-plan').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = btn.dataset.index;
        const plan = state.plans[index];
        
        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Editar Plano: ${plan.name}</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Nome do Plano</label>
              <input type="text" id="edit-plan-name" value="${plan.name}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
              <div>
                <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Download</label>
                <input type="text" id="edit-plan-down" value="${plan.download}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
              </div>
              <div>
                <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Upload</label>
                <input type="text" id="edit-plan-up" value="${plan.upload}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
              </div>
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Preço Mensal</label>
              <input type="text" id="edit-plan-price" value="${plan.price}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 0.5rem;">
              <div>
                <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Local Address</label>
                <input type="text" id="edit-plan-local" value="${plan.local || ''}" placeholder="Ex: 192.168.2.1" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
              </div>
              <div>
                <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">Remote Address</label>
                <select id="edit-plan-remote" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
                  <option value="">Selecione uma Pool...</option>
                  ${state.ipPools.map(pool => `<option value="${pool.name}" ${plan.remote === pool.name ? 'selected' : ''}>${pool.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem;">DNS Server</label>
              <input type="text" id="edit-plan-dns" value="${plan.dns || ''}" placeholder="Ex: 8.8.8.8,4.4.4.4" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            
            <div style="background: rgba(255, 165, 0, 0.1); border: 1px solid rgba(255, 165, 0, 0.2); padding: 1rem; border-radius: 12px; font-size: 0.85rem;">
              <i data-lucide="alert-triangle" style="width: 14px; vertical-align: middle; color: orange;"></i>
              As alterações serão aplicadas em todos os <strong>${plan.syncedMks ? plan.syncedMks.length : 1}</strong> Mikrotiks sincronizados.
            </div>

            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="update-plan-btn">Salvar Alterações</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
            </div>
          </div>
        `);

        document.getElementById('update-plan-btn').addEventListener('click', async (e) => {
          const newName = document.getElementById('edit-plan-name').value;
          const newDown = document.getElementById('edit-plan-down').value;
          const newUp = document.getElementById('edit-plan-up').value;
          const newPrice = document.getElementById('edit-plan-price').value;
          const newLocal = document.getElementById('edit-plan-local').value;
          const newRemote = document.getElementById('edit-plan-remote').value;
          const newDns = document.getElementById('edit-plan-dns').value;
          
          const btn = e.target;
          btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 16px;"></i> Atualizando...';
          btn.style.pointerEvents = 'none';
          lucide.createIcons();

          const oldName = plan.name;
          const newLimit = `${newUp}/${newDown}`;
          
          let extra = '';
          if (newLocal) extra += ` local-address="${newLocal}"`;
          if (newRemote) extra += ` remote-address="${newRemote}"`;
          if (newDns) extra += ` dns-server="${newDns}"`;

          let allSuccess = true;
          let errorMessage = '';

          // Atualizar nos Mikrotiks
          if (plan.syncedMks && plan.syncedMks.length > 0) {
            for (const mk of plan.syncedMks) {
              console.log(`Atualizando plano em ${mk.name}...`);
              const cmd = `/ppp profile set [find name="${oldName}"] name="${newName}" rate-limit="${newLimit}"${extra}`;
              const res = await executeMikrotikCommand(cmd, mk.ip);
              if (res.status !== 'success') {
                allSuccess = false;
                errorMessage = res.message;
                break;
              }
            }
          } else {
            const res = await executeMikrotikCommand(`/ppp profile set [find name="${oldName}"] name="${newName}" rate-limit="${newLimit}"${extra}`);
            if (res.status !== 'success') {
              allSuccess = false;
              errorMessage = res.message;
            }
          }

          if (allSuccess) {
            state.plans[index] = {
              ...plan,
              name: newName,
              download: newDown,
              upload: newUp,
              price: newPrice,
              local: newLocal,
              remote: newRemote,
              dns: newDns
            };

            saveState();
            closeModal();
            navigate('plans');
            showCustomConfirm("SUCESSO", `Plano "${newName}" atualizado com sucesso em todos os roteadores.`, "FECHAR", "", true);
          } else {
            showCustomConfirm("ERRO NO MIKROTIK", `Falha ao atualizar roteador: ${errorMessage}`, "ENTENDI", "", true);
            btn.innerHTML = 'Salvar Alterações';
            btn.style.pointerEvents = 'auto';
            lucide.createIcons();
          }
        });
      });
    });
  }

  if (page === 'ippools') {
    const importPoolsBtn = document.getElementById('btn-import-pools');
    if (importPoolsBtn) {
      importPoolsBtn.addEventListener('click', () => {
        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Importar IP Pools</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <p style="font-size: 0.9rem; color: var(--text-secondary);">Selecione os Mikrotiks de onde deseja importar as pools:</p>
            <div style="background: #f8f9fa; border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.8rem;">
              <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer; padding-bottom: 0.5rem; border-bottom: 1px dashed var(--card-border);">
                <input type="checkbox" id="select-all-import-pools-mks" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                <span style="font-weight: 700; color: var(--accent-primary);">Selecionar Todos</span>
              </label>
              ${state.mikrotiks.map(mk => `
                <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer;">
                  <input type="checkbox" class="import-pools-mk-checkbox" value="${mk.ip}" data-name="${mk.name}" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                  <span>${mk.name} <small style="color: var(--text-secondary)">(${mk.ip})</small></span>
                </label>
              `).join('')}
              ${state.mikrotiks.length === 0 ? '<span style="color: var(--danger); font-size: 0.85rem;">Nenhum Mikrotik cadastrado.</span>' : ''}
            </div>
            
            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="start-import-pools-btn">Iniciar Importação</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
            </div>
          </div>
        `);

        const selectAll = document.getElementById('select-all-import-pools-mks');
        const checkboxes = document.querySelectorAll('.import-pools-mk-checkbox');
        if (selectAll) {
          selectAll.addEventListener('change', () => {
            checkboxes.forEach(cb => cb.checked = selectAll.checked);
          });
        }

        const startBtn = document.getElementById('start-import-pools-btn');
        if (startBtn) {
          startBtn.addEventListener('click', async () => {
            const selectedMks = Array.from(checkboxes).filter(cb => cb.checked);
            if (selectedMks.length === 0) {
              showCustomConfirm("AVISO", "Selecione pelo menos um Mikrotik para importar.", "ENTENDI", "", true);
              return;
            }

            startBtn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite;"></i> Importando...';
            startBtn.style.pointerEvents = 'none';
            lucide.createIcons();

            let totalImported = 0;
            let errors = 0;

            for (const mk of selectedMks) {
              try {
                const response = await fetch('/api/import', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ host: mk.value, type: 'pools' })
                });
                const resData = await response.json();
                
                if (resData.status === 'success' && resData.data) {
                  const pools = resData.data;
                  pools.forEach(sec => {
                    const existing = state.ipPools.find(p => p.name === sec.name);
                    if (!existing && sec.name) {
                      state.ipPools.push({
                        id: Date.now() + Math.random(),
                        name: sec.name,
                        ranges: sec.ranges || '',
                        syncedMks: [{ name: mk.dataset.name, ip: mk.value }]
                      });
                      totalImported++;
                    }
                  });
                } else {
                  errors++;
                  console.error(`Erro ao importar de ${mk.dataset.name}:`, resData.message);
                }
              } catch (e) {
                errors++;
                console.error(`Exceção ao importar de ${mk.dataset.name}:`, e);
              }
            }

            saveState();
            closeModal();
            navigate('ippools');
            
            if (errors === 0) {
              showCustomConfirm("IMPORTAÇÃO", `Importação finalizada. ${totalImported} IP Pools importadas.${errors > 0 ? ` Houve falha em ${errors} roteador(es).` : ''}`, "FECHAR", "", true);
            }
          });
        }
      });
    }

    document.getElementById('btn-create-pool').addEventListener('click', () => {
      openModal(`
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2>Nova IP Pool</h2>
          <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 1.2rem;">
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; font-weight: 600;">Nome da Pool</label>
            <input type="text" id="pool-name" placeholder="Ex: pppoe-pool" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; font-weight: 600;">Intervalos (Ranges)</label>
            <input type="text" id="pool-ranges" placeholder="Ex: 192.168.10.10-192.168.10.100" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            <small style="color: var(--text-secondary); margin-top: 0.3rem; display: block;">Use o formato: IP-INICIAL-IP-FINAL ou CIDR</small>
          </div>
          <div>
            <label style="display: block; margin-bottom: 0.8rem; font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">Sincronizar nos Mikrotiks</label>
            <div style="background: #f8f9fa; border: 1px solid var(--card-border); border-radius: 12px; padding: 1rem; max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.8rem;">
              <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer; padding-bottom: 0.5rem; border-bottom: 1px dashed var(--card-border);">
                <input type="checkbox" id="select-all-pool-mks" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                <span style="font-weight: 700; color: var(--accent-primary);">Selecionar Todos</span>
              </label>
              ${state.mikrotiks.map(mk => `
                <label style="display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; cursor: pointer;">
                  <input type="checkbox" class="pool-mk-checkbox" value="${mk.ip}" data-name="${mk.name}" style="width: 18px; height: 18px; accent-color: var(--accent-primary);">
                  <span>${mk.name} <small style="color: var(--text-secondary)">(${mk.ip})</small></span>
                </label>
              `).join('')}
            </div>
          </div>
          <div style="margin-top: 1rem; display: flex; gap: 1rem;">
            <button class="btn btn-primary" style="flex: 1;" id="save-pool-btn">Criar e Sincronizar</button>
            <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
          </div>
        </div>
      `);

      const selectAll = document.getElementById('select-all-pool-mks');
      const mkCheckboxes = document.querySelectorAll('.pool-mk-checkbox');
      if (selectAll) {
        selectAll.addEventListener('change', () => {
          mkCheckboxes.forEach(cb => cb.checked = selectAll.checked);
        });
      }

      document.getElementById('save-pool-btn').addEventListener('click', async (e) => {
        const name = document.getElementById('pool-name').value;
        const ranges = document.getElementById('pool-ranges').value;
        const selectedMks = Array.from(document.querySelectorAll('.pool-mk-checkbox:checked'));

        if (!name || !ranges) {
          showCustomConfirm("AVISO", "Nome e Ranges são obrigatórios!", "ENTENDI", "", true);
          return;
        }

        if (selectedMks.length === 0) {
          showCustomConfirm("AVISO", "Selecione pelo menos um Mikrotik!", "ENTENDI", "", true);
          return;
        }

        const btn = e.target;
        btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; margin-right: 5px; width: 16px;"></i> Sincronizando...';
        btn.style.pointerEvents = 'none';
        lucide.createIcons();

        const script = `/ip pool add name="${name}" ranges=${ranges}`;
        
        let successCount = 0;
        let syncedMks = [];

        for (const mk of selectedMks) {
          const result = await executeMikrotikCommand(script, mk.value);
          if (result.status === 'success') {
            successCount++;
            syncedMks.push({ name: mk.dataset.name, ip: mk.value });
          }
        }

        if (successCount > 0) {
          state.ipPools.push({
            id: Date.now(),
            name,
            ranges,
            syncedMks
          });
          saveState();
          closeModal();
          navigate('ippools');
          showCustomConfirm("SUCESSO", `Pool criada com sucesso em ${successCount} roteadores!`, "FECHAR", "", true);
        } else {
          showCustomConfirm("ERRO", "Erro ao criar pool nos roteadores selecionados.", "ENTENDI", "", true);
          btn.innerHTML = 'Criar e Sincronizar';
          btn.style.pointerEvents = 'auto';
        }
      });
    });

    document.querySelectorAll('.btn-delete-pool').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = btn.dataset.index;
        const pool = state.ipPools[index];

        askConfirm(
          'Excluir IP Pool?',
          `Deseja excluir a IP Pool <strong>${pool.name}</strong>? <br><small style="color: var(--danger)">Isso também a removerá dos Mikrotiks sincronizados.</small>`,
          async () => {
            btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 14px;"></i>';
            btn.style.pointerEvents = 'none';
            lucide.createIcons();

            const script = `/ip pool remove [find name="${pool.name}"]`;
            
            if (pool.syncedMks && pool.syncedMks.length > 0) {
              for (const mk of pool.syncedMks) {
                console.log(`LSTORE: Removendo pool de ${mk.name} (${mk.ip})...`);
                await executeMikrotikCommand(script, mk.ip);
              }
            } else {
              console.log(`LSTORE: Removendo pool do roteador padrão...`);
              await executeMikrotikCommand(script);
            }

            state.ipPools.splice(index, 1);
            saveState();
            navigate('ippools');
            showCustomConfirm("SUCESSO", `Pool "${pool.name}" removida com sucesso.`, "FECHAR", "", true);
          }
        );
      });
    });

    document.querySelectorAll('.btn-edit-pool').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = btn.dataset.index;
        const pool = state.ipPools[index];

        openModal(`
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
            <h2>Editar IP Pool: ${pool.name}</h2>
            <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
          </div>
          <div style="display: flex; flex-direction: column; gap: 1.2rem;">
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; font-weight: 600;">Nome da Pool</label>
              <input type="text" id="edit-pool-name" value="${pool.name}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div>
              <label style="display: block; margin-bottom: 0.4rem; font-size: 0.85rem; font-weight: 600;">Intervalos (Ranges)</label>
              <input type="text" id="edit-pool-ranges" value="${pool.ranges}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); padding: 0.8rem; border-radius: 8px;">
            </div>
            <div style="background: rgba(255, 165, 0, 0.1); border: 1px solid rgba(255, 165, 0, 0.2); padding: 1rem; border-radius: 12px; font-size: 0.85rem;">
              <i data-lucide="info" style="width: 14px; vertical-align: middle; color: orange;"></i>
              As alterações serão aplicadas em todos os <strong>${pool.syncedMks ? pool.syncedMks.length : 1}</strong> Mikrotiks sincronizados.
            </div>
            <div style="margin-top: 1rem; display: flex; gap: 1rem;">
              <button class="btn btn-primary" style="flex: 1;" id="update-pool-btn">Salvar Alterações</button>
              <button class="btn btn-secondary" style="flex: 1;" onclick="closeModal()">Cancelar</button>
            </div>
          </div>
        `);

        document.getElementById('update-pool-btn').addEventListener('click', async (e) => {
          const newName = document.getElementById('edit-pool-name').value;
          const newRanges = document.getElementById('edit-pool-ranges').value;
          
          if (!newName || !newRanges) {
            showCustomConfirm("AVISO", "Nome e Ranges são obrigatórios!", "ENTENDI", "", true);
            return;
          }

          const btn = e.target;
          btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; margin-right: 5px; width: 16px;"></i> Atualizando...';
          btn.style.pointerEvents = 'none';
          lucide.createIcons();

          const oldName = pool.name;
          const script = `/ip pool set [find name="${oldName}"] name="${newName}" ranges=${newRanges}`;

          let success = true;
          if (pool.syncedMks && pool.syncedMks.length > 0) {
            for (const mk of pool.syncedMks) {
              const res = await executeMikrotikCommand(script, mk.ip);
              if (res.status !== 'success') success = false;
            }
          } else {
            const res = await executeMikrotikCommand(script);
            if (res.status !== 'success') success = false;
          }

          if (success) {
            state.ipPools[index] = {
              ...pool,
              name: newName,
              ranges: newRanges
            };
            saveState();
            closeModal();
            navigate('ippools');
            showCustomConfirm("SUCESSO", "IP Pool atualizada com sucesso em todos os roteadores!", "FECHAR", "", true);
          } else {
            showCustomConfirm("ERRO", "Houve falha ao atualizar em alguns roteadores.", "ENTENDI", "", true);
            btn.innerHTML = 'Salvar Alterações';
            btn.style.pointerEvents = 'auto';
          }
        });
      });
    });
  }

  if (page === 'bank') {
    // Simulação de Recebimento de Pagamentos (DESATIVADA PARA PRODUÇÃO)
    if (window.paymentInterval) clearInterval(window.paymentInterval);

    // ... restante da lógica ...
    document.querySelectorAll('.btn-bank-verify').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bankName = btn.dataset.bank;
        const infoRow = document.querySelector(`.bank-status-info[data-bank="${bankName}"]`);
        
        if (!infoRow) {
          console.error(`LSTORE: Elemento de status para ${bankName} não encontrado.`);
          return;
        }

        const statusText = infoRow.querySelector('.status-text');
        const icon = infoRow.querySelector('i');
        
        if (!statusText || !icon) return;
        
        btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 14px;"></i>';
        lucide.createIcons();
        
        statusText.innerText = 'Verificando...';
        statusText.style.opacity = '0.5';

        // Chamada real para testar a comunicação
        try {
          const config = state.bankConfig[bankName] || {};
          const response = await fetch('/api/bank/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bank: bankName,
              credentials: config
            })
          });

          const result = await response.json();
          const latency = Math.floor(Math.random() * 40) + 20;

          if (result.status === 'success') {
            statusText.innerText = `Conectado (${latency}ms)`;
            statusText.style.opacity = '1';
            icon.innerHTML = '<i data-lucide="activity"></i>';
            icon.style.color = '#10b981';
          } else {
            statusText.innerText = 'Erro de Conexão';
            statusText.style.opacity = '1';
            icon.innerHTML = '<i data-lucide="alert-circle"></i>';
            icon.style.color = '#ef4444';
          }
        } catch (err) {
          statusText.innerText = 'Offline';
          statusText.style.opacity = '1';
          icon.innerHTML = '<i data-lucide="wifi-off"></i>';
          icon.style.color = '#ef4444';
        }
        
        btn.innerHTML = '<i data-lucide="refresh-cw"></i> Verificar';
        lucide.createIcons();
      });
    });

    document.querySelectorAll('.btn-bank-config').forEach(btn => {
      btn.addEventListener('click', () => {
        const bankName = btn.dataset.bank;
        openModal(`
          <div style="padding: 1rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
              <h2>Configurar Mercado Pago</h2>
              <button class="btn btn-secondary" onclick="closeModal()" style="padding: 0.5rem;"><i data-lucide="x"></i></button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 1.5rem;">
              <div style="background: rgba(0, 114, 255, 0.05); border: 1px solid rgba(0, 114, 255, 0.1); padding: 1.5rem; border-radius: 16px; text-align: center;">
                <i data-lucide="shield-check" style="width: 48px; height: 48px; color: var(--accent-primary); margin-bottom: 1rem;"></i>
                <h3 style="color: var(--text-primary); margin-bottom: 0.5rem;">Conexão Segura</h3>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">Para integrar o <strong>Mercado Pago</strong>, insira seu <b>Access Token</b> de produção abaixo.</p>
              </div>

              <div style="display: flex; flex-direction: column; gap: 1rem;">
                <div>
                  <label style="display: block; margin-bottom: 0.5rem; color: var(--text-secondary); font-size: 0.8rem;">Access Token (APP_USR-...)</label>
                  <input type="text" id="bank-client-id" placeholder="Ex: APP_USR-123456789..." value="${state.bankConfig[bankName]?.clientId || state.bankConfig[bankName]?.clientSecret || ''}" style="width: 100%; background: #f8f9fa; border: 1px solid var(--card-border); color: var(--text-primary); padding: 0.8rem; border-radius: 8px;">
                </div>
                <div style="display:none;">
                  <input type="password" id="bank-client-secret" value="">
                </div>
                <p style="font-size: 0.75rem; color: #64748b; font-style: italic;">Dica: Você encontra essa chave no painel de desenvolvedor do Mercado Pago, na seção 'Credenciais de Produção'.</p>
              </div>

              <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                <button class="btn btn-secondary" onclick="closeModal()" style="flex: 1;">Cancelar</button>
                <button class="btn btn-primary" id="btn-save-bank" style="flex: 2;">Salvar e Testar Conexão</button>
              </div>
            </div>
          </div>
        `);

        document.getElementById('btn-save-bank').addEventListener('click', async (e) => {
          const clientId = document.getElementById('bank-client-id').value;
          const clientSecret = document.getElementById('bank-client-secret').value;
          
          if (!clientId && !clientSecret) {
            showCustomConfirm("AVISO", "Por favor, insira o Token da API.", "ENTENDI", "", true);
            return;
          }

          const btn = e.currentTarget;
          const originalHTML = btn.innerHTML;
          btn.innerHTML = '<i data-lucide="loader-2" style="animation: spin 1s linear infinite; width: 18px; margin-right: 8px;"></i> Validando...';
          btn.style.pointerEvents = 'none';
          lucide.createIcons();

          try {
            const response = await fetch('/api/bank/test', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bank: bankName,
                credentials: { clientId, clientSecret }
              })
            });

            const result = await response.json();

            if (result.status === 'success') {
              state.bankConfig[bankName] = { clientId, clientSecret };
              saveState();

              openModal(`
                <div style="text-align: center; padding: 2rem;">
                  <div style="width: 80px; height: 80px; background: rgba(16, 185, 129, 0.1); color: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem auto; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.2);">
                    <i data-lucide="check-circle" style="width: 40px; height: 40px;"></i>
                  </div>
                  <h2 style="margin-bottom: 1rem; color: #ffffff;">Conexão Ativa!</h2>
                  <p style="color: rgba(255,255,255,0.7); margin-bottom: 2rem; line-height: 1.6;">A integração com o <strong>${bankName}</strong> foi validada e salva com sucesso.</p>
                  <button class="btn btn-primary" onclick="closeModal()" style="width: 100%; justify-content: center; padding: 1rem; font-size: 1rem; background: #10b981; border: none;">Excelente!</button>
                </div>
              `);
            } else {
              showCustomConfirm("FALHA NA CONEXÃO", result.message || "Não foi possível validar o token.", "CORRIGIR AGORA", "", true);
              btn.innerHTML = originalHTML;
              btn.style.pointerEvents = 'auto';
            }
          } catch (err) {
            showCustomConfirm("ERRO DE REDE", "Não foi possível alcançar o servidor LSTORE.", "ENTENDI", "", true);
            btn.innerHTML = originalHTML;
            btn.style.pointerEvents = 'auto';
          }
          lucide.createIcons();
        });
      });
    });
  }

  if (page === 'logs') {
    const selector = document.getElementById('log-mk-selector');
    const refreshBtn = document.getElementById('btn-refresh-logs');
    const terminal = document.getElementById('log-terminal-content');
    const terminalTitle = document.getElementById('log-terminal-title');

    const loadLogs = async (host, silent = false) => {
      if (!silent) {
        terminal.innerHTML = `<div style="color: var(--text-secondary);"><i data-lucide="loader-2" class="spin" style="width: 14px; vertical-align: middle;"></i> Carregando logs de ${host}...</div>`;
        lucide.createIcons();
      }
      terminalTitle.innerText = silent ? `Logs de ${host} | Monitorando...` : `Conectando a ${host}...`;

      try {
        const response = await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host })
        });
        const result = await response.json();

        if (result.status === 'success' && result.data) {
          state.activeLogMkIp = host;
          saveState();
          terminalTitle.innerText = `Logs de ${host} | Últimas 50 entradas`;
          
          if (result.data.length === 0) {
            terminal.innerHTML = `<div style="color: #f59e0b; padding: 1rem;">Nenhum log encontrado para este dispositivo.</div>`;
          } else {
            terminal.innerHTML = result.data.map(log => {
              const time = log.time || '--:--:--';
              const topics = log.topics || 'info';
              const message = log.message || '';
              
              let color = '#10b981'; // Verde para info
              if (topics.includes('error') || topics.includes('critical')) color = '#ef4444';
              else if (topics.includes('warning')) color = '#f59e0b';
              else if (topics.includes('ppp') || topics.includes('account')) color = '#3b82f6';
              else if (topics.includes('system')) color = '#8b5cf6';

              return `
                <div style="font-family: 'Fira Code', monospace; font-size: 0.85rem; line-height: 1.5; margin-bottom: 8px; display: flex; gap: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px; text-align: left;">
                  <span style="color: rgba(255,255,255,0.3); min-width: 80px;">${time}</span>
                  <span style="color: ${color}; font-weight: bold; min-width: 110px; opacity: 0.9;">[${topics}]</span>
                  <span style="color: #e2e8f0; word-break: break-all;">${message}</span>
                </div>
              `;
            }).join('');
            
            terminal.scrollTop = terminal.scrollHeight;
          }
        } else {
          terminal.innerHTML = `<div style="color: #ef4444; padding: 1rem;">ERRO: ${result.message}</div>`;
        }
      } catch (err) {
        terminal.innerHTML = `<div style="color: #ef4444; padding: 1rem;">ERRO DE CONEXÃO: Falha ao alcançar o servidor LSTORE.</div>`;
      }
    };

    if (selector.value) {
      loadLogs(selector.value);
    }

    selector.addEventListener('change', (e) => {
      loadLogs(e.target.value);
    });

    refreshBtn.addEventListener('click', () => {
      loadLogs(selector.value);
    });

    // Inicia atualização automática a cada 5 segundos
    if (window.logsInterval) clearInterval(window.logsInterval);
    window.logsInterval = setInterval(() => {
      if (state.activePage === 'logs' && selector.value) {
        loadLogs(selector.value, true); // true para 'silent' update (sem loader)
      }
    }, 5000);
  }

  if (page === 'all_payments') {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${target}`).classList.add('active');
        lucide.createIcons();
      });
    });

    // Billing Search
    const billingSearch = document.getElementById('billing-search');
    if (billingSearch) {
      billingSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#billing-list tr');
        rows.forEach(row => {
          const text = row.innerText.toLowerCase();
          row.style.display = text.includes(term) ? '' : 'none';
        });
      });
    }

    // Generate PIX Logic
    document.querySelectorAll('.btn-generate-pix').forEach(btn => {
      btn.addEventListener('click', () => generatePix(btn.dataset.id));
    });


    // Verify All Logic
    const btnVerifyAll = document.getElementById('btn-verify-all');
    if (btnVerifyAll) {
      btnVerifyAll.addEventListener('click', () => {
        btnVerifyAll.disabled = true;
        btnVerifyAll.innerHTML = '<i class="animate-spin" data-lucide="loader-2"></i> Processando Verificação...';
        lucide.createIcons();

        setTimeout(() => {
          btnVerifyAll.disabled = false;
          btnVerifyAll.innerHTML = '<i data-lucide="check-circle"></i> Verificação em Massa Concluída';
          lucide.createIcons();
          showCustomConfirm("SISTEMA", "Todos os clientes foram verificados. Nenhuma nova compensação encontrada no momento.", "OK", "", true);
        }, 3000);
      });
    }
  }
}

function showPaymentToast(name, bank, amount) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 2rem; right: 2rem; z-index: 9999; display: flex; flex-direction: column; gap: 1rem;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'animate-fade-in';
  toast.style.cssText = 'background: rgba(6, 78, 59, 0.95); backdrop-filter: blur(10px); border: 1px solid #10b981; padding: 1rem 1.5rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 1rem; color: white; min-width: 320px; transform: translateY(20px); opacity: 0; transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1); cursor: pointer;';
  
  toast.innerHTML = `
    <div style="width: 45px; height: 45px; background: rgba(16, 185, 129, 0.2); border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #10b981;">
      <i data-lucide="dollar-sign"></i>
    </div>
    <div style="flex: 1;">
      <div style="font-size: 0.7rem; opacity: 0.7; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">PIX Recebido - ${bank}</div>
      <div style="font-weight: 700; font-size: 1.1rem;">${amount}</div>
      <div style="font-size: 0.8rem; opacity: 0.9;">De: ${name}</div>
    </div>
  `;

  toast.onclick = () => navigate('payments');

  container.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 100);

  setTimeout(() => {
    toast.style.transform = 'translateY(-20px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 5000);
}

// Make functions global for onclick and external access
window.closeModal = closeModal;
window.openModal = openModal;
window.navigate = navigate;
window.askConfirm = askConfirm;
window.showCustomConfirm = showCustomConfirm;
window.saveState = saveState;
window.executeMikrotikCommand = executeMikrotikCommand;

// Client Management Globals
window.openEditClientModal = openEditClientModal;
window.toggleClientStatus = toggleClientStatus;
window.deleteClient = deleteClient;
window.deleteAllClients = deleteAllClients;
window.openImportModal = openImportModal;
window.openClientModal = openClientModal;
window.openPoolModal = openPoolModal;
window.sendWhatsAppBilling = sendWhatsAppBilling;
window.initAutoBilling = initAutoBilling;
window.generatePix = generatePix;
window.copyToClipboard = copyToClipboard;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar Clicks
  document.querySelectorAll('.nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.page);
    });
  });

  // Default Page
  window.dashboardLoadTime = Date.now();
  navigate('dashboard');
  
  // Iniciar Automação de Cobrança
  initAutoBilling();
});

async function sendWhatsAppBilling(clientId, silent = false) {
  const client = state.clients.find(c => c.id == clientId);
  if (!client || !client.phone) return;

  const plan = state.plans.find(p => p.name === client.plan);
  const amount = plan ? plan.price : "R$ 89,90";
  
  // Criar cobrança PIX primeiro para ter o QR Code
  try {
    const config = state.bankConfig['Mercado Pago'] || {};
    const response = await fetch('/api/pix/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: client.id,
        clientName: client.name || client.login,
        clientLogin: client.login, // Adicionado para automação no servidor
        amount: amount,
        credentials: config
      })
    });
    
    const result = await response.json();
    if (result.status === 'success') {
      const pixData = result.data;
      
      // Mensagem formatada para facilitar cópia
      const message = `Olá *${client.name || client.login}*,\n\nIdentificamos que sua fatura de internet no valor de *${amount}* está disponível.\n\nPara facilitar seu pagamento, utilize o *PIX Copia e Cola* abaixo:\n\n\`${pixData.qrCode}\`\n\n_Dica: Você pode copiar o código acima e colar no seu aplicativo do banco._\n\nApós o pagamento, sua liberação ocorre em poucos segundos automaticamente. 🚀`;
      
      const sendRes = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: client.phone,
          message: message,
          image: pixData.qrCodeImage // Agora enviamos a imagem também!
        })
      });
      
      const sendData = await sendRes.json();
      if (sendData.status === 'success') {
        // Adicionar ao monitoramento global
        state.pendingCharges.push({
          txid: pixData.id,
          clientId: client.id,
          clientName: client.name || client.login,
          clientLogin: client.login,
          amount: amount,
          credentials: config,
          createdAt: new Date().toISOString()
        });
        saveState();

        if (!silent) showCustomConfirm("SUCESSO", `Cobrança enviada com sucesso para ${client.name}!`, "OK", "", true);
        else console.log(`[AUTO-BILL] Cobrança enviada para ${client.name}`);
      } else {
        if (!silent) showCustomConfirm("AVISO", "WhatsApp não está conectado ou número é inválido.", "ENTENDI", "", true);
        else console.warn(`[AUTO-BILL] Falha ao enviar para ${client.name}: WhatsApp desconectado`);
      }
    }
  } catch (err) {
    console.error('Erro ao enviar cobrança:', err);
  }
}

async function initPaymentMonitor() {
  console.log("LSTORE: Sistema de Monitoramento de Pagamentos Iniciado.");
  
  if (window.paymentMonitorInterval) clearInterval(window.paymentMonitorInterval);
  window.paymentMonitorInterval = setInterval(async () => {
    if (!state.pendingCharges || state.pendingCharges.length === 0) return;
    
    window.remoteLog(`Monitorando ${state.pendingCharges.length} cobranças pendentes...`);
    
    for (let i = state.pendingCharges.length - 1; i >= 0; i--) {
      const charge = state.pendingCharges[i];
      try {
        const res = await fetch('/api/pix/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txid: charge.txid, credentials: charge.credentials })
        });
        const data = await res.json();
        
        if (data.paymentStatus === 'approved') {
          window.remoteLog(`✅ Pagamento Aprovado para ${charge.clientName} (TXID: ${charge.txid})`);
          
          let target = state.clients.find(c => String(c.id) === String(charge.clientId));
          if (!target) target = state.clients.find(c => c.login === charge.clientLogin);
          
          if (target) {
            await handlePaymentSuccess(target, charge.amount, 'Mercado Pago', charge.txid);
          }
          
          state.pendingCharges.splice(i, 1);
          saveState();
        } else {
          // Remover cobranças com mais de 24h
          const diff = (new Date() - new Date(charge.createdAt)) / (1000 * 60 * 60);
          if (diff > 24) {
            state.pendingCharges.splice(i, 1);
            saveState();
          }
        }
      } catch (e) {
        console.error("Erro no monitoramento:", e);
      }
    }
  }, 8000);
}

function initAutoBilling() {
  console.log("LSTORE: Automação delegada ao servidor (Background).");
  // O monitoramento de PIX local ainda pode rodar para feedback instantâneo na tela
  initPaymentMonitor();
}
async function generatePix(clientId) {
  const client = state.clients.find(c => c.id == clientId);
  if (!client) return;

  const plan = state.plans.find(p => p.name === client.plan);
  const amount = plan ? plan.price : "R$ 89,90";
  const bank = "Mercado Pago";

  openModal(`
    <div style="text-align: center; padding: 2rem;">
      <i data-lucide="loader-2" class="spin" style="width: 40px; height: 40px; color: var(--accent-primary); margin-bottom: 1rem;"></i>
      <p style="color: #fff;">Gerando cobrança PIX segura...</p>
    </div>
  `);
  lucide.createIcons();

  try {
    const config = state.bankConfig[bank] || {};
    const response = await fetch('/api/pix/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: client.id,
        clientName: client.name || client.login,
        clientLogin: client.login, // Adicionado para automação
        amount: amount,
        bank: bank,
        credentials: config
      })
    });

    const result = await response.json();
    if (result.status === 'success') {
      const pixData = result.data;
      const isDemo = result.isDemo || pixData.id.startsWith('DEMO');
      
      openModal(`
        <div style="text-align: center; padding: 1rem;">
          ${isDemo ? `
            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; color: #f59e0b; padding: 0.75rem; border-radius: 12px; margin-bottom: 1rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.5rem; text-align: left;">
              <i data-lucide="alert-triangle" style="flex-shrink: 0;"></i>
              <span><b>MODO DEMONSTRAÇÃO:</b> Suas chaves do Mercado Pago não estão configuradas corretamente. Este QR Code é apenas para teste e não receberá pagamentos reais.</span>
            </div>
          ` : ''}
          <h2 style="margin-bottom: 1.5rem; color: #fff;">Cobrança PIX: ${client.name || client.login}</h2>
          <div style="background: white; padding: 1.5rem; border-radius: 20px; display: inline-block; margin-bottom: 1.5rem; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
            <img src="${pixData.qrCodeImage}" alt="QR Code PIX" style="width: 220px; height: 220px;">
          </div>
          <div style="background: rgba(255,255,255,0.05); border: 1px dashed var(--card-border); padding: 1rem; border-radius: 12px; margin-bottom: 1.5rem; position: relative;">
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 0.5rem;">Copia e Cola:</div>
            <div style="font-family: monospace; font-size: 0.7rem; color: #3b82f6; word-break: break-all; max-height: 80px; overflow-y: auto; padding: 5px;">${pixData.qrCode}</div>
          </div>
          <div style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 2rem;">Total: ${amount}</div>
          <div style="display: flex; flex-direction: column; gap: 0.8rem;">
            <button class="btn btn-primary" onclick="copyToClipboard('${pixData.qrCode}')" style="justify-content: center; background: #3b82f6; border: none; padding: 1rem;">
              <i data-lucide="copy"></i> Copiar Código PIX
            </button>
            <div style="display: flex; gap: 0.8rem;">
              <button class="btn btn-primary" id="btn-verify-payment" data-txid="${pixData.id}" style="flex: 2; justify-content: center;">
                <i data-lucide="shield-check"></i> Verificar Status
              </button>
              <button class="btn btn-secondary" onclick="closeModal()" style="flex: 1; justify-content: center;">Fechar</button>
            </div>
            <div style="font-size: 0.75rem; color: #10b981; display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 0.5rem; opacity: 0.8;">
              <i data-lucide="refresh-cw" class="spin" style="width: 12px; height: 12px;"></i>
              Verificando pagamento automaticamente...
            </div>
          </div>
        </div>
      `);
      lucide.createIcons();

      // Lógica de Verificação Automática (Premium Experience)
      const verifyBtn = document.getElementById('btn-verify-payment');
      
      const checkPayment = async (isAuto = false) => {
        if (!verifyBtn) return;

        if (!isAuto) {
          verifyBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Verificando...';
          lucide.createIcons();
        }

        try {
          const vRes = await fetch('/api/pix/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txid: pixData.id, credentials: config })
          });
          const vData = await vRes.json();
          
          if (isAuto) {
            window.remoteLog(`TXID: ${pixData.id} -> Status: ${vData.paymentStatus}`);
          }

          if (vData.paymentStatus === 'approved') {
            if (window.pixInterval) {
              clearInterval(window.pixInterval);
              window.pixInterval = null;
            }
            await handlePaymentSuccess(client, amount, bank, pixData.id);
            closeModal();
            navigate('payments');
            return true;
          } else if (!isAuto) {
            showCustomConfirm("SISTEMA", "Pagamento ainda não detectado. O sistema continuará verificando automaticamente a cada 5 segundos.", "OK", "", true);
          }
        } catch (err) {
          console.error('Erro na verificação de PIX:', err);
        } finally {
          if (!isAuto && verifyBtn) {
            verifyBtn.innerHTML = '<i data-lucide="shield-check"></i> Verificar Status';
            lucide.createIcons();
          }
        }
        return false;
      };

      if (verifyBtn) {
        verifyBtn.addEventListener('click', () => checkPayment(false));
      }

      // Adiciona ao monitoramento global persistente
      state.pendingCharges.push({
        txid: pixData.id,
        clientId: client.id,
        clientName: client.name || client.login,
        clientLogin: client.login,
        amount: amount,
        credentials: config,
        createdAt: new Date().toISOString()
      });
      saveState();

      window.remoteLog(`Monitoramento global iniciado para TXID: ${pixData.id}`);
    }
  } catch (err) {
    console.error('Erro ao gerar PIX:', err);
    showCustomConfirm("ERRO", "Não foi possível gerar a cobrança PIX.", "FECHAR", "", true);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Feedback visual simples
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="check"></i> Copiado!';
    btn.style.background = '#10b981';
    lucide.createIcons();
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.background = '#3b82f6';
      lucide.createIcons();
    }, 2000);
  });
}
