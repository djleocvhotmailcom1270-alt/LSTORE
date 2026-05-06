# LSTORE - Sistema de Gerenciamento para Provedores

Este é um sistema premium projetado para Provedores de Internet (ISPs) gerenciarem múltiplos roteadores Mikrotik de forma centralizada.

## Funcionalidades Principais

- **Dashboard Central**: Visualize o status de todos os seus Mikrotiks e o crescimento da sua rede.
- **Gerenciamento de Mikrotiks**: Adicione e monitore roteadores em tempo real.
- **Planos de Internet**: Crie e edite planos de banda larga (Download/Upload/Preço).
- **Conexão VPN**: Comunicação segura entre o painel e os dispositivos via OpenVPN.
- **Script Autogerado**: Gere scripts personalizados para colar diretamente no terminal do Mikrotik.

## Como usar

1. **Instalação**:
   ```bash
   npm install
   npm run dev
   ```

2. **Conectando um Mikrotik**:
   - Vá para a aba **Configuração VPN**.
   - Digite o nome do roteador (ex: Borda-Central).
   - Clique em **Copiar Script**.
   - No Winbox ou Terminal do seu Mikrotik, cole o script.
   - O roteador estabelecerá uma conexão segura com o LSTORE.

3. **Criando Planos**:
   - Vá para **Planos de Internet**.
   - Defina as velocidades e o valor.
   - O sistema sincronizará as `Queues` ou `Profiles` necessários.

## Tecnologias Utilizadas

- **Vite**: Build tool ultra-rápida.
- **Vanilla JS/CSS**: Performance máxima e design customizado.
- **Lucide Icons**: Ícones modernos e consistentes.
- **Google Fonts (Inter)**: Tipografia premium.

---
Desenvolvido com foco em estética e funcionalidade para ISPs modernos.
