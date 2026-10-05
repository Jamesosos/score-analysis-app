@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 學生成績查詢系統

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   找不到 Node.js。
  echo.
  echo   沒關係，你可以直接用瀏覽器開啟這個資料夾裡的 index.html，
  echo   功能幾乎完全相同，只是不能「安裝成 App」或離線使用。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在啟動本機伺服器...
echo   啟動後請用瀏覽器開啟： http://127.0.0.1:8787/
echo.
echo   要停止伺服器，請按 Ctrl+C 或直接關閉這個視窗。
echo.

node serve.mjs %1
echo.
echo   伺服器已停止。
pause
