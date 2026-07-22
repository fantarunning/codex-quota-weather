' Stable Codex Quota Weather launcher. The Startup shortcut always points here.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
launcherDir = fso.GetParentFolderName(WScript.ScriptFullName)
installRoot = fso.GetParentFolderName(launcherDir)
nodeExe = installRoot & "\runtime\node\node.exe"
launcherJs = launcherDir & "\launcher.js"
sh.CurrentDirectory = installRoot
sh.Run """" & nodeExe & """ """ & launcherJs & """", 0, False
