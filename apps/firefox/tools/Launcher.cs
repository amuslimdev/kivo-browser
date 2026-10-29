// Kivo.exe: launcher for the Kivo engine (kivo-browser.exe), the Firefox binary from the artifact build.
// That binary has Firefox's identity compiled in (Mozilla\Firefox: profile folder, policies key, crash
// reports). Firefox reads another identity from "-app <application.ini>" as the first argument, or from
// XUL_APP_FILE (nsBrowserApp.cpp), so every start goes through here: double click, Start menu, pinned
// taskbar, and links from other apps when Kivo is the default browser.
// The identity goes in XUL_APP_FILE, not -app: a link from another app comes as "-osint -url <link>", and
// Firefox exits unless -osint is the very first argument (EnsureBrowserCommandlineSafe), so nothing may
// come before it.
// Restarts keep the identity (the engine saves XUL_APP_FILE for them). Other profiles open in a new
// engine process (Firefox's launchInstance): KIVO_APP_FILE tells KivoProfiles.sys.mjs which -app to pass.
// Updates (Updater.cs) are applied here, before the engine starts. "Restart to update" in Kivo starts
// "Kivo.exe --kivo-restart" and quits; that flag is ours and never reaches the engine. The engine also runs
// "Kivo.exe --kivo-jumplist <file>" to write the taskbar Jump Lists (JumpList.cs).
//
// Built by package.ps1 with the C# compiler that ships with Windows (.NET Framework 4), so it needs
// no runtime and no Visual Studio. Kept ASCII and C# 5.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("Kivo")]
[assembly: AssemblyProduct("Kivo")]
[assembly: AssemblyDescription("Kivo")]
[assembly: AssemblyCompany("Kivo")]
[assembly: AssemblyVersion("1.0.0.0")]

static class KivoLauncher
{
    const string RestartFlag = "--kivo-restart";

    // STA for the shell's Jump List objects (JumpList.cs).
    [STAThread]
    static int Main()
    {
        // The arguments exactly as Windows passed them (URLs, -osint, quoting).
        string arguments = ArgumentsAfterProgram(Environment.CommandLine);
        if (KivoUpdater.IsApplyRun(arguments))
        {
            return KivoUpdater.Apply(arguments);
        }
        if (KivoJumpList.IsRun(arguments))
        {
            return KivoJumpList.Write(arguments);
        }

        string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        string engine = Path.Combine(dir, "kivo-browser.exe");
        string app = Path.Combine(dir, "browser", "application.ini");
        if (!File.Exists(engine) || !File.Exists(app))
        {
            return 2;
        }

        if (arguments == RestartFlag || arguments.StartsWith(RestartFlag + " ", StringComparison.Ordinal))
        {
            arguments = arguments.Substring(RestartFlag.Length).Trim();
            KivoUpdater.WaitForEngine(dir, 30);
        }
        if (KivoUpdater.HandOff(dir, arguments))
        {
            return 0;
        }

        var start = new ProcessStartInfo(engine, arguments)
        {
            UseShellExecute = false,
            WorkingDirectory = dir,
        };
        start.EnvironmentVariables["XUL_APP_FILE"] = app;
        start.EnvironmentVariables["KIVO_APP_FILE"] = app;
        using (Process.Start(start))
        {
        }
        return 0;
    }

    /// <summary>The command line without its first token (the program path), as Windows quoted it.</summary>
    static string ArgumentsAfterProgram(string commandLine)
    {
        int i = 0;
        if (commandLine.Length > 0 && commandLine[0] == '"')
        {
            int close = commandLine.IndexOf('"', 1);
            i = close < 0 ? commandLine.Length : close + 1;
        }
        else
        {
            while (i < commandLine.Length && commandLine[i] != ' ' && commandLine[i] != '\t')
            {
                i++;
            }
        }
        return commandLine.Substring(i).Trim();
    }
}
