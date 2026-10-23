; Instalador de Minuta para Windows (por usuario, sin permisos de administrador).
; Lo arma herramientas/instalador-windows.sh con makensis (corre en Linux/Mac, sin Wine).
; Con /S instala en silencio y abre Minuta al terminar (lo usan instalar.ps1 y el actualizador de la app).
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
!include "MUI2.nsh"

Name "Minuta"
OutFile "${SALIDA}"
InstallDir "$LOCALAPPDATA\Programs\Minuta"
BrandingText "Minuta ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName" "Minuta"
VIAddVersionKey /LANG=0 "FileDescription" "Instalador de Minuta"
VIAddVersionKey /LANG=0 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright" "MIT"

!define MUI_ICON "${ICONO}"
!define MUI_UNICON "${ICONO}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Minuta.exe"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"
!insertmacro MUI_LANGUAGE "English"

!define DESINSTALAR "Software\Microsoft\Windows\CurrentVersion\Uninstall\Minuta"

Section "Minuta"
  ; Si está abierta (p. ej. al actualizar) se cierra para poder reemplazar sus archivos.
  nsExec::Exec 'taskkill /IM Minuta.exe /F'
  Sleep 1000
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${ORIGEN}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar Minuta.exe"
  CreateShortcut "$SMPROGRAMS\Minuta.lnk" "$INSTDIR\Minuta.exe"
  CreateShortcut "$DESKTOP\Minuta.lnk" "$INSTDIR\Minuta.exe"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayName" "Minuta"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${DESINSTALAR}" "Publisher" "Minuta (open source)"
  WriteRegStr HKCU "${DESINSTALAR}" "DisplayIcon" "$INSTDIR\Minuta.exe"
  WriteRegStr HKCU "${DESINSTALAR}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${DESINSTALAR}" "UninstallString" '"$INSTDIR\Desinstalar Minuta.exe"'
  WriteRegStr HKCU "${DESINSTALAR}" "QuietUninstallString" '"$INSTDIR\Desinstalar Minuta.exe" /S'
  WriteRegStr HKCU "${DESINSTALAR}" "URLInfoAbout" "https://minuta-app.github.io/minuta/"
  WriteRegDWORD HKCU "${DESINSTALAR}" "NoModify" 1
  WriteRegDWORD HKCU "${DESINSTALAR}" "NoRepair" 1
  IfSilent 0 +2
    Exec '"$INSTDIR\Minuta.exe"'
SectionEnd

; Desinstalar quita la app; tus notas, perfil y grabaciones (carpeta minuta) no se tocan.
Section "Uninstall"
  nsExec::Exec 'taskkill /IM Minuta.exe /F'
  Sleep 800
  Delete "$SMPROGRAMS\Minuta.lnk"
  Delete "$DESKTOP\Minuta.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${DESINSTALAR}"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.minuta.escritorio"
SectionEnd
