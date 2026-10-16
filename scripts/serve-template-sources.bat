@echo off
rem Double-click to preview every website in "C:\My Web Sites\New templates websites"
rem on its own localhost port (needs Node.js 18+ from https://nodejs.org).
rem Keep serve-template-sources.mjs in the same folder as this file.
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and try again. & pause & exit /b 1)
node "%~dp0serve-template-sources.mjs" "C:\My Web Sites\New templates websites" --open
pause
