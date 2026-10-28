@echo off
REM SIMSA: commit pertama dan push ke GitHub. Jalankan dari folder SIMSANew.
cd /d "%~dp0"
if not exist .git git init -b main
git add .
git status --short | findstr /r /c:"\.env$" >nul && (echo [BERHENTI] Berkas .env ikut ter-stage. Periksa .gitignore. & exit /b 1)
git commit -m "SIMSA MVP Fase 1: skema Supabase + RLS, server Node.js, frontend Vite React"
git remote get-url origin >nul 2>&1 || git remote add origin https://github.com/danizal-rtikus/SIMSANEW.git
git push -u origin main
pause
