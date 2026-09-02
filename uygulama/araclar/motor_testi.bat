@echo off
chcp 65001 >nul
title MacroPad - motor testi
cd /d "%~dp0.."

echo ==========================================================
echo   MacroPad motor testi
echo ==========================================================
echo.
echo Klasor : %CD%
echo.

if exist "engine\engine.py" goto :varmis
echo [HATA] engine\engine.py BULUNAMADI.
echo        Zip acilirken klasor yapisi bozulmus.
echo        Bu .bat dosyasi ile ayni klasorde "engine" klasoru,
echo        onun icinde de engine.py olmali.
echo.
dir /b
echo.
pause
goto :eof
:varmis
echo engine\engine.py : bulundu
echo.

call :findpy
if not defined PY goto :nopython
echo Yorumlayici : %PY%
%PY% --version
echo.

echo pynput kontrolu...
%PY% -c "import pynput; print('pynput SURUM', pynput.__version__ if hasattr(pynput,'__version__') else 'ok')"
if errorlevel 1 (
  echo pynput YOK, kuruluyor...
  %PY% -m pip install pynput
)
echo.

echo ----------------------------------------------------------
echo Motor baslatiliyor. Asagida su satiri gormelisin:
echo    {"ev": "ready"}
echo Gorduysen her sey yolunda; Ctrl+C ile kapat.
echo Baska bir sey yaziyorsa o mesaji bana gonder.
echo ----------------------------------------------------------
echo.
%PY% engine\engine.py
echo.
pause
goto :eof

:findpy
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY ( python -c "import sys" >nul 2>nul && set "PY=python" )
if not defined PY ( python3 -c "import sys" >nul 2>nul && set "PY=python3" )
exit /b

:nopython
echo [HATA] Calisan bir Python bulunamadi.
echo        Komut isteminde "py -3 --version" calisiyorsa bunu bana bildir.
echo.
pause
goto :eof
