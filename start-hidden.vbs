' Quota-Weather silent launcher.
' Starts the tray app with NO console window and NO flash. Used both by the
' Startup shortcut (autostart) and for manual launch.
Set sh = CreateObject("WScript.Shell")
appDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
' 0 = hidden window, False = don't wait. Launches Electron via npm's electron.cmd
' shim is avoided; call the electron.exe directly for reliability on Node 24.
electronExe = appDir & "\node_modules\electron\dist\electron.exe"
sh.CurrentDirectory = appDir
sh.Run """" & electronExe & """ """ & appDir & """", 0, False
