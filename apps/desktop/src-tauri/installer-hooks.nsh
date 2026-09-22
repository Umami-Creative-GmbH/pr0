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
