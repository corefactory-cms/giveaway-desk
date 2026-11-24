@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
if exist "%~dp0runtime\python.exe" goto embedded
where py.exe >nul 2>nul
if not errorlevel 1 goto installed_launcher
where python.exe >nul 2>nul
if not errorlevel 1 goto installed_python
echo 실행하려면 GitHub Releases에서 GiveawayDesk-Windows-x64.zip을 받아 압축을 푸세요.
if "%~1"=="" pause
exit /b 1

:embedded
"%~dp0runtime\python.exe" -B "%~dp0app.py" %*
goto finish

:installed_launcher
py.exe -3 -B "%~dp0app.py" %*
goto finish

:installed_python
python.exe -B "%~dp0app.py" %*

:finish
set "run_status=%errorlevel%"
if not "%run_status%"=="0" if "%~1"=="" pause
exit /b %run_status%
