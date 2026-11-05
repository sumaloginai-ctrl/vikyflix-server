Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Q = Chr(34)
tmpT = WshShell.ExpandEnvironmentStrings("%TEMP%") & "\vikyflix_tasklist.txt"
tmpN = WshShell.ExpandEnvironmentStrings("%TEMP%") & "\vikyflix_netstat.txt"

' Start Cloudflare Tunnel only if one is not already running
' (spawning a tunnel on every run leaked ~10 duplicate processes)
' Uses Run + temp file instead of Exec, because Exec flashes a visible CMD window
WshShell.Run "%COMSPEC% /c tasklist /FI " & Q & "IMAGENAME eq cloudflared.exe" & Q & " /FO CSV /NH > " & Q & tmpT & Q, 0, True
strT = ""
If fso.FileExists(tmpT) Then
  strT = fso.OpenTextFile(tmpT, 1).ReadAll
  fso.DeleteFile tmpT
End If
If InStr(1, strT, "cloudflared.exe", 1) = 0 Then
  WshShell.CurrentDirectory = "E:\projects\My Streaming Services\server"
  WshShell.Run "%COMSPEC% /c start /b cloudflared.exe tunnel run", 0, False
End If

' Start the Node server only if port 5000 is not already listening
' (a second npm start would die with EADDRINUSE and pollute the process list)
WshShell.Run "%COMSPEC% /c netstat -ano > " & Q & tmpN & Q, 0, True
strNet = ""
If fso.FileExists(tmpN) Then
  strNet = fso.OpenTextFile(tmpN, 1).ReadAll
  fso.DeleteFile tmpN
End If
bListening = False
For Each nLine In Split(strNet, vbCrLf)
  If InStr(nLine, ":5000") > 0 And InStr(nLine, "LISTENING") > 0 Then
    bListening = True
    Exit For
  End If
Next
If Not bListening Then
  WshShell.Run "%COMSPEC% /c npm start >> server.log 2>&1", 0, False
End If
