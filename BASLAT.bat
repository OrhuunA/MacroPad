@echo off
chcp 65001 >nul
title MacroPad
cd /d "%~dp0uygulama"
set "LOG=%~dp0kurulum.log"

rem ---- ilk kurulum tamamlandiysa dogrudan basla ----------------
if not exist "node_modules\electron" goto :kurulum
call :findpy
if not defined PYCMD goto :kurulum
"%PYCMD%" %PYARG% -c "import pynput" >nul 2>nul
if errorlevel 1 goto :kurulum
goto :basla

rem =============================================================
rem  ILK KURULUM
rem =============================================================
:kurulum
cls
echo.
echo   ============================================================
echo                        M A C R O P A D
echo   ============================================================
echo.
echo   Ilk calistirma: gerekli dosyalar kuruluyor.
echo   Bu yalnizca bir kez olur, sonraki acilislar aninda baslar.
echo.

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

echo   [1/4] Python...
call :findpy
if defined PYCMD goto :py_var
echo         Bulunamadi, kuruluyor. Birkac dakika surebilir...
where winget >nul 2>nul
if errorlevel 1 goto :py_indir
winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity >>"%LOG%" 2>&1
call :pathyenile
call :findpy
if defined PYCMD goto :py_var

:py_indir
where curl >nul 2>nul
if errorlevel 1 goto :py_elle
curl -L --progress-bar -o "%TEMP%\mp-python.exe" "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
if not exist "%TEMP%\mp-python.exe" goto :py_elle
"%TEMP%\mp-python.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_test=0
del "%TEMP%\mp-python.exe" >nul 2>nul
call :pathyenile
call :findpy
if not defined PYCMD goto :yeniden_ac
:py_var
echo         Tamam.

echo   [2/4] Node.js...
call :findnode
if defined NPM goto :node_var
echo         Bulunamadi, kuruluyor...
where winget >nul 2>nul
if errorlevel 1 goto :node_elle
winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity >>"%LOG%" 2>&1
call :pathyenile
call :findnode
if not defined NPM goto :yeniden_ac
:node_var
echo         Tamam.

echo   [3/4] Klavye motoru...
"%PYCMD%" %PYARG% -c "import pynput" >nul 2>nul
if not errorlevel 1 goto :pyn_var
"%PYCMD%" %PYARG% -m pip install --quiet pynput >>"%LOG%" 2>&1
"%PYCMD%" %PYARG% -c "import pynput" >nul 2>nul
if not errorlevel 1 goto :pyn_var
"%PYCMD%" %PYARG% -m pip install --quiet --user pynput >>"%LOG%" 2>&1
"%PYCMD%" %PYARG% -c "import pynput" >nul 2>nul
if errorlevel 1 goto :pyn_hata
:pyn_var
echo         Tamam.

echo   [4/4] Arayuz paketleri... ilk seferde birkac dakika surer.
rem Yarim kalmis bir kurulum varsa temizle, yoksa npm ustune kurmaya
rem calisip daha kotu hatalar veriyor.
if not exist "node_modules" goto :temiz2
if exist "node_modules\electron\package.json" goto :temiz2
echo         Bozuk yarim kurulum siliniyor...
rmdir /s /q "node_modules" >nul 2>nul
:temiz2

if exist "node_modules\electron\package.json" goto :npm_var
call "%NPM%" install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 >>"%LOG%" 2>&1
if exist "node_modules\electron\package.json" goto :npm_var
echo         Olmadi, ayna sunucu ile tekrar deneniyor...
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
call "%NPM%" install --no-audit --no-fund --fetch-retries=5 --fetch-timeout=120000 >>"%LOG%" 2>&1
if not exist "node_modules\electron\package.json" goto :npm_hata
:npm_var
echo         Tamam.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $w.SpecialFolders.Item('Desktop') 'MacroPad.lnk')); $s.TargetPath='%~dp0BASLAT.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.IconLocation='%~dp0uygulama\build\icon.ico'; $s.Save()" >nul 2>nul

echo.
echo   Kurulum tamam. Masaustune kisayol eklendi.
echo.
timeout /t 2 >nul

rem =============================================================
:basla
call :findpy
call :findnode
set "MACROPAD_PYEXE=%PYCMD%"
set "MACROPAD_PYARGS=%PYARG%"
call "%NPM%" start
goto :eof

rem =============================================================
rem  YARDIMCI
rem =============================================================
:findpy
rem Yeni py baslaticisi olmayan bir surum icin de 0 dondurebiliyor;
rem bu yuzden cikis koduna degil gercek ciktiya bakiyoruz.
set "PYCMD="
set "PYARG="

call :probe "py -3"
if not defined MP_OK goto :fp2
set "PYCMD=py"
set "PYARG=-3"
exit /b

:fp2
call :probe "python"
if not defined MP_OK goto :fp3
set "PYCMD=python"
exit /b

:fp3
call :probe "python3"
if not defined MP_OK goto :fp4
set "PYCMD=python3"
exit /b

:fp4
if not exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" goto :fp5
set "PYCMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
exit /b

:fp5
if not exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" goto :fp6
set "PYCMD=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
exit /b

:fp6
exit /b

:probe
set "MP_OK="
for /f "delims=" %%V in ('%~1 -c "print(9876)" 2^>nul') do if "%%V"=="9876" set "MP_OK=1"
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

:pathyenile
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "MP_UP=%%B"
for /f "skip=2 tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "MP_SP=%%B"
if defined MP_SP set "PATH=%PATH%;%MP_SP%"
if defined MP_UP set "PATH=%PATH%;%MP_UP%"
exit /b

rem =============================================================
rem  HATALAR
rem =============================================================
:yeniden_ac
echo.
echo   Kurulum yapildi ama bu pencere hala eski ayarlarla calisiyor.
echo   Bu pencereyi KAPAT, BASLAT.bat dosyasina bir kez daha cift tikla.
echo.
pause
goto :eof

:py_elle
echo.
echo   Python otomatik kurulamadi. Acilan sayfadan indirip kur,
echo   kurulum ekranindaki "Add python.exe to PATH" kutusunu ISARETLE,
echo   sonra BASLAT.bat dosyasini tekrar calistir.
echo.
start "" "https://www.python.org/downloads/"
pause
goto :eof

:node_elle
echo.
echo   Node.js otomatik kurulamadi. Acilan sayfadan LTS surumunu kur,
echo   sonra BASLAT.bat dosyasini tekrar calistir.
echo.
start "" "https://nodejs.org/"
pause
goto :eof

:pyn_hata
echo.
echo   Klavye motoru kurulamadi. Ayrinti: kurulum.log
echo.
pause
goto :eof

:npm_hata
echo.
echo   Arayuz paketleri kurulamadi (Electron indirilemedi).
echo   ------------------ kurulum.log son satirlar ------------------
powershell -NoProfile -Command "if (Test-Path '%LOG%') { Get-Content -Path '%LOG%' -Tail 20 }"
echo   --------------------------------------------------------------
echo.
echo   VPN kullaniyorsan kapat, kullanmiyorsan ac; guvenlik duvarini
echo   kontrol et; sonra tekrar dene.
echo.
pause
goto :eof
