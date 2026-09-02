@echo off
chcp 65001 >nul
title MacroPad - EXE olustur
cd /d "%~dp0uygulama"
set "LOG=%~dp0derleme.log"
if exist "%LOG%" del "%LOG%" >nul 2>nul
cls
echo.
echo   ============================================================
echo             M A C R O P A D   -   E X E   O L U S T U R
echo   ============================================================
echo.
echo   Bu islem sonunda "dist" klasorunde iki dosya olusur:
echo.
echo     MacroPad-Tasinabilir-1.0.0.exe   tek dosya, kurulum yok
echo     MacroPad-Kurulum-1.0.0.exe       kurulum sihirbazi
echo.
echo   Bu dosyalari BASKA bir bilgisayara kopyalayip calistirabilirsin.
echo   Karsi bilgisayarda Python, Node ya da baska hicbir sey GEREKMEZ.
echo.
echo   Ayrinti gunlugu: derleme.log
echo   ------------------------------------------------------------
echo.

rem ---------------------------------------------------------------
rem ---- OneDrive uyarisi ----------------------------------------
echo %CD% | find /i "OneDrive" >nul
if errorlevel 1 goto :yol_ok
echo.
echo   ============================================================
echo    UYARI: Bu klasor OneDrive icinde.
echo   ============================================================
echo.
echo    OneDrive dosyalari surekli senkronlar ve kilitler; npm ile
echo    Electron burada cok sik hata verir. Zaten aldigin hatalarin
echo    sebebi buyuk ihtimalle bu.
echo.
echo    YAP: MacroPad klasorunu OneDrive DISINA tasi, ornegin
echo         C:\MacroPad
echo    Sonra oradan bu dosyayi tekrar calistir.
echo.
choice /c ED /n /m "   Yine de devam edilsin mi? (E=Evet / D=Dur) "
if errorlevel 2 goto :eof
echo.
:yol_ok

echo [1/5] PyInstaller ile calisan bir Python araniyor...
set "PYOK="
call :trypy "py -3.12"
call :trypy "py -3.13"
call :trypy "py -3.11"
call :trypy "py -3"
call :trypy "python"
if defined PYOK goto :pyfound

echo.
echo       Uygun bir Python bulunamadi. 3.12 kurulmayi deneniyor...
py install 3.12 >>"%LOG%" 2>&1
call :trypy "py -3.12"
if defined PYOK goto :pyfound

where winget >nul 2>nul
if errorlevel 1 goto :nopython
echo       winget ile Python 3.12 kuruluyor, birkac dakika surebilir...
winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity >>"%LOG%" 2>&1
call :pathyenile
call :trypy "py -3.12"
call :trypy "python"
if not defined PYOK goto :nopython

:pyfound
echo       Kullanilacak: %PYOK%  (Python %PYVER%)
echo.

rem ---------------------------------------------------------------
echo [2/5] Motor tek dosyaya derleniyor...
if exist "engine\dist" rmdir /s /q "engine\dist" >nul 2>nul
if exist "engine\build" rmdir /s /q "engine\build" >nul 2>nul
%PYOK% -m PyInstaller --noconfirm --onefile --name macropad-engine --distpath engine\dist --workpath engine\build --specpath engine engine\engine.py >>"%LOG%" 2>&1
if not exist "engine\dist\macropad-engine.exe" goto :enginefail
echo       macropad-engine.exe olusturuldu.

rem motor gercekten calisiyor mu
echo [3/5] Motor test ediliyor...
echo {"cmd":"quit"}| "engine\dist\macropad-engine.exe" > "%TEMP%\mp_engine_test.txt" 2>>"%LOG%"
findstr /C:"ready" "%TEMP%\mp_engine_test.txt" >nul 2>nul
if errorlevel 1 goto :enginetestfail
echo       Motor calisiyor.
del "%TEMP%\mp_engine_test.txt" >nul 2>nul
echo.

rem ---------------------------------------------------------------
echo [4/5] Node paketleri kontrol ediliyor...
call :findnode
if not defined NPM goto :nonode

rem Yarim kalmis bir kurulum varsa temizle, yoksa npm ustune kurmaya
rem calisip daha kotu hatalar veriyor.
if not exist "node_modules" goto :temiz
if exist "node_modules\electron\package.json" goto :temiz
echo       Bozuk yarim kurulum siliniyor...
rmdir /s /q "node_modules" >nul 2>nul
:temiz

rem Daha once kurulmus bir kopya varsa onu kullan (indirmeye gerek kalmaz)
if exist "node_modules\electron\package.json" goto :npm_ok
call :eskiden_kopyala
if exist "node_modules\electron\package.json" goto :npm_ok

echo       Kuruluyor, birkac dakika surebilir...
call "%NPM%" install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 >>"%LOG%" 2>&1
if exist "node_modules\electron\package.json" goto :npm_ok

echo       Olmadi. Ayna sunucu uzerinden tekrar deneniyor...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
call "%NPM%" install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 >>"%LOG%" 2>&1
if not exist "node_modules\electron\package.json" goto :npmfail

:npm_ok
echo       Hazir.
echo.

rem ---------------------------------------------------------------
echo [5/5] Windows paketi olusturuluyor...
echo       Bu adim ilk seferde Electron dosyalarini indirir, sabirli ol.
call "%NPM%" run dist >>"%LOG%" 2>&1

set "OK="
if exist "dist\MacroPad-Tasinabilir-1.0.0.exe" set "OK=1"
if exist "dist\MacroPad-Kurulum-1.0.0.exe" set "OK=1"
if defined OK goto :dist_ok

echo       Olmadi. Ayna sunucu uzerinden tekrar deneniyor...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
call "%NPM%" run dist >>"%LOG%" 2>&1
if exist "dist\MacroPad-Tasinabilir-1.0.0.exe" set "OK=1"
if exist "dist\MacroPad-Kurulum-1.0.0.exe" set "OK=1"
if not defined OK goto :distfail

:dist_ok

echo.
echo   ============================================================
echo     BITTI
echo   ============================================================
echo.
dir /b "dist\*.exe"
echo.
echo   Arkadasina gonderecegin dosya:
echo     dist\MacroPad-Tasinabilir-1.0.0.exe
echo   Indirip cift tiklamasi yeterli. Kurulum bile gerekmiyor.
echo.
start "" "%~dp0uygulama\dist"
pause
goto :eof

rem ===============================================================
rem  YARDIMCI RUTINLER
rem ===============================================================
:trypy
rem DIKKAT: yeni py baslaticisi olmayan bir surum icin de 0 dondurebiliyor,
rem bu yuzden cikis koduna degil GERCEK CIKTIYA bakiyoruz.
if defined PYOK exit /b
set "MP_PROBE="
for /f "delims=" %%V in ('%~1 -c "print(9876)" 2^>nul') do set "MP_PROBE=%%V"
if not "%MP_PROBE%"=="9876" exit /b

set "MP_VER="
for /f "delims=" %%V in ('%~1 -c "import sys;print(sys.version.split()[0])" 2^>nul') do set "MP_VER=%%V"
echo       %~1  =^>  Python %MP_VER% bulundu, PyInstaller kuruluyor...
%~1 -m pip install --quiet --upgrade pyinstaller pynput >>"%LOG%" 2>&1

set "MP_PI="
for /f "delims=" %%V in ('%~1 -m PyInstaller --version 2^>nul') do set "MP_PI=%%V"
if not defined MP_PI (
  echo         PyInstaller bu surumde calismiyor, digerini deniyorum.
  exit /b
)

set "MP_PN="
for /f "delims=" %%V in ('%~1 -c "import pynput;print(1234)" 2^>nul') do set "MP_PN=%%V"
if not "%MP_PN%"=="1234" (
  echo         pynput bu surume kurulamadi, digerini deniyorum.
  exit /b
)

set "PYOK=%~1"
set "PYVER=%MP_VER%"
exit /b

:pathyenile
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "MP_UP=%%B"
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "MP_SP=%%B"
if defined MP_SP set "PATH=%PATH%;%MP_SP%"
if defined MP_UP set "PATH=%PATH%;%MP_UP%"
exit /b

:eskiden_kopyala
rem Daha once calistirilmis bir MacroPad klasoru varsa node_modules'u oradan al.
for %%D in ("%~dp0..\macropad-electron" "%~dp0..\MacroPad-eski\uygulama" "%~dp0..\..\macropad-electron") do (
  if exist "%%~fD\node_modules\electron\package.json" (
    echo       Onceki kurulumdan kopyalaniyor: %%~fD
    xcopy /e /i /q /y "%%~fD\node_modules" "node_modules" >nul 2>&1
    goto :eof
  )
)
exit /b

:findnode
rem npm'i TAM YOL ile bul. Cip "npm" yazarsak cmd once bulundugu klasore
rem bakar ve yanlis bir npm.cmd calisirsa npm-cli.js'i proje klasorunde arar.
set "NPM="
for /f "delims=" %%N in ('where npm.cmd 2^>nul') do if not defined NPM set "NPM=%%N"
if not defined NPM for /f "delims=" %%N in ('where npm 2^>nul') do if not defined NPM set "NPM=%%N"
if not defined NPM if exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not defined NPM if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "NPM=%ProgramFiles(x86)%\nodejs\npm.cmd"
if not defined NPM if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "NPM=%LOCALAPPDATA%\Programs\nodejs\npm.cmd"
if not defined NPM exit /b

rem gercekten calisiyor mu
set "MP_NPMV="
for /f "delims=" %%V in ('"%NPM%" -v 2^>nul') do if not defined MP_NPMV set "MP_NPMV=%%V"
if not defined MP_NPMV set "NPM="
exit /b

rem ===============================================================
rem  HATALAR
rem ===============================================================
:nopython
echo.
echo   PyInstaller ile calisan bir Python bulunamadi.
echo.
echo   Sendeki Python surumunu PyInstaller heniz desteklemiyor olabilir.
echo   COZUM: acilan sayfadan Python 3.12 kur, kurulum ekranindaki
echo   "Add python.exe to PATH" kutusunu ISARETLE, sonra bu dosyayi
echo   tekrar calistir. Mevcut surumu SILME, yan yana dururlar.
echo.
start "" "https://www.python.org/downloads/release/python-3128/"
pause
goto :eof

:enginefail
echo.
echo   Motor exe olusturulamadi.
echo   ------------------ derleme.log son satirlar ------------------
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -Path '%LOG%' -Tail 25 }"
echo   --------------------------------------------------------------
echo.
echo   Bu satirlari bana gonder. Gunluk dosyasi: %LOG%
pause
goto :eof

:enginetestfail
echo.
echo   Motor derlendi ama calismadi. Muhtemelen antivirus engelledi.
echo   Windows Guvenligi ^> Virus korumasi ^> Ayarlar ^> Dislanan ogeler
echo   listesine bu klasoru ekleyip tekrar dene.
echo.
pause
goto :eof

:nonode
echo.
echo   Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kur,
echo   bilgisayari yeniden baslat, sonra tekrar dene.
echo.
start "" "https://nodejs.org/"
pause
goto :eof

:npmfail
echo.
echo   Node paketleri kurulamadi (Electron indirilemedi).
echo   ------------------ derleme.log son satirlar ------------------
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -Path '%LOG%' -Tail 25 }"
echo   --------------------------------------------------------------
echo.
echo   Bunlari dene:
echo     - VPN kullaniyorsan kapat, kullanmiyorsan ac
echo     - Guvenlik duvari / antivirus npm'i engelliyor olabilir
echo     - Daha once calisan bir MacroPad klasorundeki node_modules
echo       klasorunu su konuma kopyala:  %~dp0uygulama\
echo.
pause
goto :eof

:distfail
echo.
echo   Paket olusturulamadi. En sik sebep: electron-builder gerekli
echo   dosyalari indiremedi (internet / guvenlik duvari / VPN).
echo   ------------------ derleme.log son satirlar ------------------
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -Path '%LOG%' -Tail 25 }"
echo   --------------------------------------------------------------
pause
goto :eof
