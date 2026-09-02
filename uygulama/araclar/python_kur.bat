@echo off
chcp 65001 >nul
title MacroPad - Python kurulum yardimcisi
cd /d "%~dp0.."

echo ==========================================================
echo   MacroPad - Python kurulum yardimcisi
echo ==========================================================
echo.

call :findpy
if defined PY goto :zaten

echo Python bulunamadi, kurulacak.
echo.

where winget >nul 2>nul
if errorlevel 1 goto :indir

echo [Yontem 1] winget ile kuruluyor...
winget install --id Python.Python.3.13 -e --source winget --accept-package-agreements --accept-source-agreements
call :findpy
if defined PY goto :kuruldu
echo winget ile olmadi, dogrudan indirmeyi deniyorum...
echo.

:indir
where curl >nul 2>nul
if errorlevel 1 goto :elle

set "PYURL=https://www.python.org/ftp/python/3.13.15/python-3.13.15-amd64.exe"
set "PYEXE=%TEMP%\python-3.13.15-amd64.exe"

echo [Yontem 2] python.org adresinden indiriliyor (yaklasik 25 MB)...
curl -L -o "%PYEXE%" "%PYURL%"
if not exist "%PYEXE%" goto :elle

echo Kuruluyor... Bu adim birkac dakika surebilir, pencereyi kapatma.
"%PYEXE%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
del "%PYEXE%" >nul 2>nul

call :findpy
if defined PY goto :kuruldu

rem PATH bu pencerede henuz guncellenmedi; bilinen kurulum yolunu dene
set "GUESS=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if exist "%GUESS%" set "PY=%GUESS%"
if defined PY goto :kuruldu
goto :yenidenac

:kuruldu
echo.
echo Python kuruldu: %PY%
echo pynput kuruluyor...
%PY% -m pip install --upgrade pip
%PY% -m pip install pynput
%PY% -c "import pynput" >nul 2>nul
if errorlevel 1 goto :pipfail
echo.
echo ==========================================================
echo   HAZIR. Simdi calistir.bat dosyasina cift tikla.
echo ==========================================================
echo.
pause
goto :eof

:zaten
echo Python zaten kurulu: %PY%
echo pynput kontrol ediliyor...
%PY% -c "import pynput" >nul 2>nul
if not errorlevel 1 goto :hepsitamam
%PY% -m pip install pynput
%PY% -c "import pynput" >nul 2>nul
if errorlevel 1 goto :pipfail
:hepsitamam
echo.
echo Her sey hazir. calistir.bat dosyasina cift tikla.
echo.
pause
goto :eof

:findpy
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY ( python -c "import sys" >nul 2>nul && set "PY=python" )
if not defined PY ( python3 -c "import sys" >nul 2>nul && set "PY=python3" )
exit /b

:yenidenac
echo.
echo Kurulum bitti ama bu pencere eski PATH ile calisiyor.
echo Bu pencereyi KAPAT, sonra python_kur.bat dosyasini bir kez daha calistir.
echo.
pause
goto :eof

:pipfail
echo.
echo pynput kurulamadi. Elle dene:
echo    %PY% -m pip install pynput
echo.
pause
goto :eof

:elle
echo.
echo Otomatik kurulum yapilamadi. Elle kur:
echo   1. https://www.python.org/downloads/ adresine git
echo   2. "Download Python" dugmesine bas
echo   3. Kurulum ekraninda "Add python.exe to PATH" kutusunu ISARETLE
echo   4. Kurulumdan sonra bu dosyayi tekrar calistir
echo.
pause
goto :eof
