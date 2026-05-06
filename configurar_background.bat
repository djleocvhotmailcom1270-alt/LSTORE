@echo off
title LSTORE - Instalacao Background
color 0E

echo ===================================================
echo       LSTORE V2 - CONFIGURACAO DE SEGUNDO PLANO
echo ===================================================
echo.
echo Este script ira configurar o servidor para rodar
echo mesmo com o navegador e este terminal fechados.
echo.

:: Verifica se o Node.js esta instalado
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao encontrado! Instale o Node.js primeiro.
    pause
    exit
)

:: Verifica se o PM2 esta instalado
call pm2 -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] PM2 nao encontrado. Instalando globalmente...
    npm install pm2 -g
)

echo.
echo [1/2] Iniciando servidor em segundo plano...
call pm2 start server.js --name lstore-server

echo.
echo [2/2] Configurando para iniciar com o Windows...
call pm2 save

echo.
echo ===================================================
echo              CONFIGURACAO CONCLUIDA!
echo ===================================================
echo.
echo O servidor agora esta rodando em SEGUNDO PLANO.
echo.
echo 1. O monitoramento de clientes funcionara 24h.
echo 2. O desbloqueio automatico via PIX esta ativo.
echo 3. Acesse de qualquer PC da rede usando o IP deste computador.
echo.
echo Exemplo: http://192.168.1.50:3000
echo.
echo Para ver o que o servidor esta fazendo: pm2 logs
echo Para parar o servidor: pm2 stop lstore-server
echo.
echo ===================================================
pause
