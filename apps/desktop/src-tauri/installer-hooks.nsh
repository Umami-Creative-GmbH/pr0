; Tauri includes this after utils.nsh. Replace its force-shutdown macro for
; BOTH install and uninstall: only the resident UI may resolve an open draft.
!include "Win\RestartManager.nsh"
!macroundef CheckIfAppIsRunning
!macro CheckIfAppIsRunning executableName productName
  !insertmacro RestartManager_StartSession $R0
  ${If} $R0 == ""
    Abort "Could not check whether pr0 is running. Close pr0 and retry setup."
  ${EndIf}
  !insertmacro RestartManager_RegisterFile $R0 "$INSTDIR\${executableName}"
  ${If} $0 != 0
    !insertmacro RestartManager_EndSession $R0
    Abort "Could not check whether pr0 is running. Close pr0 and retry setup."
  ${EndIf}
  System::Call 'RSTRTMGR::RmGetList(i R0, *i .r1, *i .r2, p 0, *i .r3) i .r0'
  ${If} $0 != 0
    !insertmacro RestartManager_EndSession $R0
    MessageBox MB_OK "Use Quit pr0 in the notification area, resolve unsaved changes, then retry setup. Setup will not close pr0 for you." /SD IDOK
    Abort
  ${EndIf}
  !insertmacro RestartManager_EndSession $R0
!macroend

; The pinned Tauri template invokes SetContext in .onInit, before it can run a
; predecessor's uninstaller. Official NSIS upgrades are always in-place: older
; uninstallers may force-close pr0 and must never participate in this handoff.
!macroundef SetContext
!macro SetContext
  !if "${INSTALLMODE}" != "currentUser"
    !error "pr0 releases require a per-user installer"
  !endif
  !if "${ARCH}" != "x64"
    !error "pr0 releases require Windows x64"
  !endif
  SetShellVarContext current
  SetRegView 64
  !ifndef __UNINSTALL__
    StrCpy $UpdateMode 0
    StrCpy $PassiveMode 1
    ; The stock template may run a machine/MSI uninstaller before honoring
    ; UpdateMode. Such migrations are unsupported; never invoke that executable.
    StrCpy $R4 0
    pr0_machine_scan:
      EnumRegKey $R5 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R4
      StrCmp $R5 "" pr0_machine_scan_done
      IntOp $R4 $R4 + 1
      ReadRegStr $R6 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R5" "DisplayName"
      ReadRegStr $R7 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R5" "Publisher"
      ${If} "$R6$R7" == "${PRODUCTNAME}${MANUFACTURER}"
        MessageBox MB_OK "A machine-wide pr0 installation was found. Quit pr0 and contact your distributor for migration instructions; setup will not run its uninstaller." /SD IDOK
        Abort
      ${EndIf}
      Goto pr0_machine_scan
    pr0_machine_scan_done:
    ReadRegStr $R0 HKCU "${UNINSTKEY}" "UninstallString"
    ${If} $R0 != ""
      StrCpy $UpdateMode 1
      ReadRegStr $R0 HKCU "${UNINSTKEY}" "DisplayVersion"
      ${If} $R0 == ""
        Abort "The installed pr0 version is unknown. Contact your distributor for recovery."
      ${EndIf}
      nsis_tauri_utils::SemverCompare "${VERSION}" $R0
      Pop $R0
      ${If} $R0 != 0
      ${AndIf} $R0 != 1
        MessageBox MB_OK "A newer or unknown pr0 version is installed. Setup cannot downgrade it." /SD IDOK
        Abort
      ${EndIf}
    ${EndIf}
  !endif
!macroend
