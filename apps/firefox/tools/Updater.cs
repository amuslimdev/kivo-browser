// Kivo updates (G6 in docs/FIREFOX.md). KivoShell.sys.mjs downloads a new Kivo in the background into
// %LOCALAPPDATA%\Kivo\updates and writes ready.txt (the zip, its signature, its build id). The next time
// Kivo.exe starts and no Kivo engine is running from the install folder, it hands off to a copy of itself
// outside that folder, which checks the zip's signature with the public key built into it (ReleaseKey.cs,
// from apps/firefox/release-key.pub.xml), swaps the whole folder (the old one is renamed back if anything
// fails), and starts the new Kivo. A zip with a bad signature is deleted and the old Kivo starts.
// Built into Kivo.exe with Launcher.cs. Kept ASCII and C# 5 (.NET Framework 4 csc).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Threading;
using Microsoft.Win32;

static class KivoUpdater
{
    const string ApplyFlag = "--kivo-apply-update";

    /// <summary>%LOCALAPPDATA%\Kivo\updates, or KIVO_UPDATES_DIR (tests).</summary>
    public static string UpdatesDir()
    {
        string custom = Environment.GetEnvironmentVariable("KIVO_UPDATES_DIR");
        if (!string.IsNullOrEmpty(custom))
        {
            return custom;
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Kivo", "updates");
    }

    public static bool IsApplyRun(string arguments)
    {
        return arguments.StartsWith(ApplyFlag + " ", StringComparison.Ordinal);
    }

    /// <summary>A Kivo engine (any profile) running from this install folder.</summary>
    public static bool EngineRunning(string dir)
    {
        string inside = dir.TrimEnd('\\') + "\\";
        foreach (Process process in Process.GetProcessesByName("kivo-browser"))
        {
            try
            {
                if (process.MainModule.FileName.StartsWith(inside, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            catch (Exception)
            {
                // Another user's process, or it just exited.
            }
            finally
            {
                process.Dispose();
            }
        }
        return false;
    }

    /// <summary>"Restart to update": Kivo quits right after starting us, so wait for it.</summary>
    public static void WaitForEngine(string dir, int seconds)
    {
        for (int i = 0; i < seconds * 4 && EngineRunning(dir); i++)
        {
            Thread.Sleep(250);
        }
    }

    /// <summary>If an update is ready, start a copy of Kivo.exe outside the install folder to apply it.</summary>
    public static bool HandOff(string dir, string arguments)
    {
        string updates = UpdatesDir();
        if (!File.Exists(Path.Combine(updates, "ready.txt")) || EngineRunning(dir))
        {
            return false;
        }
        try
        {
            string copy = Path.Combine(updates, "kivo-updater.exe");
            File.Copy(Path.Combine(dir, "Kivo.exe"), copy, true);
            var start = new ProcessStartInfo(copy, ApplyFlag + " \"" + dir.TrimEnd('\\') + "\" " + arguments)
            {
                UseShellExecute = false,
                WorkingDirectory = updates,
            };
            using (Process.Start(start))
            {
            }
            return true;
        }
        catch (Exception e)
        {
            Log("Could not start the updater: " + e.Message);
            return false;
        }
    }

    /// <summary>The copy outside the install folder: apply the update, then start Kivo with the same arguments.</summary>
    public static int Apply(string arguments)
    {
        string rest = arguments.Substring(ApplyFlag.Length).Trim();
        int close = rest.IndexOf('"', 1);
        string dir = rest.Substring(1, close - 1);
        string forward = rest.Substring(close + 1).Trim();
        try
        {
            ApplyTo(dir);
        }
        catch (Exception e)
        {
            Log("Update failed: " + e.Message);
        }
        var start = new ProcessStartInfo(Path.Combine(dir, "Kivo.exe"), forward)
        {
            UseShellExecute = false,
            WorkingDirectory = dir,
        };
        using (Process.Start(start))
        {
        }
        return 0;
    }

    static void ApplyTo(string dir)
    {
        string updates = UpdatesDir();
        string readyFile = Path.Combine(updates, "ready.txt");
        Dictionary<string, string> ready = ReadFields(readyFile);
        string zip = Path.Combine(updates, Path.GetFileName(Field(ready, "file")));
        string staged = Path.Combine(updates, "staged");
        try
        {
            if (!SignatureOk(zip, Field(ready, "signature")))
            {
                Log("Bad signature on " + Path.GetFileName(zip) + ", not installed.");
                return;
            }
            if (Directory.Exists(staged))
            {
                Directory.Delete(staged, true);
            }
            ZipFile.ExtractToDirectory(zip, staged);
            string fresh = Path.Combine(staged, "Kivo");
            if (!File.Exists(Path.Combine(fresh, "Kivo.exe")) || !File.Exists(Path.Combine(fresh, "kivo-browser.exe")))
            {
                Log("The update is not a Kivo folder, not installed.");
                return;
            }
            // From the signed zip, not ready.txt: an old release is signed too, and must not replace a newer Kivo.
            string freshBuild = IniValue(Path.Combine(fresh, "browser", "application.ini"), "BuildID") ?? "";
            string installedBuild = IniValue(Path.Combine(dir, "browser", "application.ini"), "BuildID") ?? "";
            if (string.CompareOrdinal(freshBuild, installedBuild) <= 0)
            {
                Log("The update (" + freshBuild + ") is not newer than Kivo (" + installedBuild + "), not installed.");
                return;
            }

            string previous = dir + ".previous";
            TryDelete(previous);
            if (Directory.Exists(previous))
            {
                previous = dir + ".previous-" + DateTime.Now.Ticks;
            }
            // The Kivo.exe that started us is still exiting, and Defender or Explorer may be reading a file.
            MoveWithRetry(dir, previous, 15);
            try
            {
                Directory.Move(fresh, dir);
            }
            catch (Exception)
            {
                Directory.Move(previous, dir);
                throw;
            }
            // install.ps1 puts the uninstaller next to Kivo; the release zip doesn't have it.
            string uninstall = Path.Combine(previous, "uninstall.ps1");
            if (File.Exists(uninstall))
            {
                File.Copy(uninstall, Path.Combine(dir, "uninstall.ps1"), true);
            }
            UpdateAppsEntry(dir);
            Log("Updated to " + freshBuild + ".");
            TryDelete(previous);
        }
        finally
        {
            // Whatever happened, this download is done: a good one is installed, a bad one must not be retried.
            TryDelete(staged);
            TryDeleteFile(zip);
            TryDeleteFile(readyFile);
        }
    }

    static bool SignatureOk(string zip, string signature)
    {
        if (!File.Exists(zip) || string.IsNullOrEmpty(signature))
        {
            return false;
        }
        using (var rsa = new RSACng())
        using (var data = File.OpenRead(zip))
        {
            rsa.FromXmlString(ReleaseKey.PublicKeyXml);
            return rsa.VerifyData(data, Convert.FromBase64String(signature), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
    }

    static void MoveWithRetry(string from, string to, int seconds)
    {
        for (int i = 0; ; i++)
        {
            try
            {
                Directory.Move(from, to);
                return;
            }
            catch (IOException)
            {
                if (i >= seconds * 2)
                {
                    throw;
                }
                Thread.Sleep(500);
            }
            catch (UnauthorizedAccessException)
            {
                if (i >= seconds * 2)
                {
                    throw;
                }
                Thread.Sleep(500);
            }
        }
    }

    /// <summary>Settings > Apps shows the new version (only for the Kivo that install.ps1 registered there).</summary>
    static void UpdateAppsEntry(string dir)
    {
        string version = IniValue(Path.Combine(dir, "browser", "application.ini"), "Version");
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Kivo", true))
        {
            if (key == null || version == null)
            {
                return;
            }
            string location = key.GetValue("InstallLocation") as string;
            if (location != null && string.Equals(location.TrimEnd('\\'), dir, StringComparison.OrdinalIgnoreCase))
            {
                key.SetValue("DisplayVersion", version);
            }
        }
    }

    static string IniValue(string file, string name)
    {
        if (!File.Exists(file))
        {
            return null;
        }
        foreach (string line in File.ReadAllLines(file))
        {
            if (line.StartsWith(name + "=", StringComparison.Ordinal))
            {
                return line.Substring(name.Length + 1).Trim();
            }
        }
        return null;
    }

    static Dictionary<string, string> ReadFields(string file)
    {
        var fields = new Dictionary<string, string>();
        foreach (string line in File.ReadAllLines(file))
        {
            int eq = line.IndexOf('=');
            if (eq > 0)
            {
                fields[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
        }
        return fields;
    }

    static string Field(Dictionary<string, string> fields, string name)
    {
        string value;
        return fields.TryGetValue(name, out value) ? value : "";
    }

    static void TryDelete(string folder)
    {
        try
        {
            if (Directory.Exists(folder))
            {
                Directory.Delete(folder, true);
            }
        }
        catch (Exception)
        {
            // Next update cleans it.
        }
    }

    static void TryDeleteFile(string file)
    {
        try
        {
            if (File.Exists(file))
            {
                File.Delete(file);
            }
        }
        catch (Exception)
        {
        }
    }

    static void Log(string message)
    {
        try
        {
            string updates = UpdatesDir();
            Directory.CreateDirectory(updates);
            File.AppendAllText(Path.Combine(updates, "update.log"), DateTime.Now.ToString("s") + " " + message + Environment.NewLine);
        }
        catch (Exception)
        {
        }
    }
}
