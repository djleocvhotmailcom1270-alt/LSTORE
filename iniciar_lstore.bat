@echo off
title Servidor LSTORE
color 0B
echo ===================================================
echo             INICIANDO SERVIDOR LSTORE
echo ===================================================
echo.
echo O servidor esta sendo iniciado na porta 3000...
echo.
echo Para acessar o painel, abra o seu navegador em:
echo http://localhost:3000
echo.
echo ===================================================
echo Pressione Ctrl + C para fechar o servidor.
echo ===================================================
echo.

node server.js
pause
