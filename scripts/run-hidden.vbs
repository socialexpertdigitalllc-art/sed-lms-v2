' Launch a command with NO console window at all.
'
' Task Scheduler flashes a console for every interactive console-app action —
' powershell -WindowStyle Hidden included (the window exists before the flag
' is read). wscript is a WINDOWED host, so nothing flashes; the same trick
' pm2-windows-startup's invisible.vbs uses for the logon entries.
'
' Deployed copy: <user home>\.pm2\run-hidden.vbs (edit here, copy there).
' Usage: wscript.exe run-hidden.vbs "C:\path\to\something.cmd"
CreateObject("Wscript.Shell").Run """" & WScript.Arguments(0) & """", 0, False
