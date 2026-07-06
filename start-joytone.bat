@echo off
rem Launch Joytone: start the local server and open the browser.
cd /d "%~dp0"
start "" http://localhost:8137/
node serve.js
