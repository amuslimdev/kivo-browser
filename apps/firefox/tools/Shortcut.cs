// A .lnk with System.AppUserModel.ID, so Windows groups Kivo's windows under its Start menu shortcut and
// a pinned taskbar icon starts Kivo.exe (with Kivo's identity), not the engine. install.ps1 loads it with
// Add-Type, so it is C# 5 for Windows PowerShell. Kept ASCII. Kivo.exe is built with it too: JumpList.cs
// makes its Jump List items with the same COM types.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class KivoShortcut
{
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder file, int max, IntPtr data, uint flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder name, int max);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder dir, int max);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder args, int max);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short key);
        void SetHotkey(short key);
        void GetShowCmd(out int cmd);
        void SetShowCmd(int cmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder path, int max, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr hwnd, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    internal struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PropVariant
    {
        public ushort Type;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr Value;
        public IntPtr Padding;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    internal interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    const ushort VT_LPWSTR = 31;
    internal static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");

    /// <summary>Writes the shortcut, replacing any file at <paramref name="lnk"/>.</summary>
    public static void Create(string lnk, string target, string workingDirectory, string description, string appUserModelId)
    {
        var link = (IShellLinkW)new ShellLink();
        link.SetPath(target);
        link.SetWorkingDirectory(workingDirectory);
        link.SetDescription(description);
        link.SetIconLocation(target, 0);

        // PKEY_AppUserModel_ID
        SetString((IPropertyStore)link, AppUserModel, 5, appUserModelId);

        ((IPersistFile)link).Save(lnk, true);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern void SHChangeNotify(int eventId, uint flags, string item, IntPtr unused);

    const int SHCNE_UPDATEITEM = 0x2000;
    const int SHCNE_ASSOCCHANGED = 0x08000000;
    const uint SHCNF_PATHW = 5;
    const int STGM_READ = 0;

    /// <summary>Quotes differ between Windows' copy of a command line and ours.</summary>
    static string Plain(string arguments)
    {
        return arguments.Replace("\"", "").Trim();
    }

    /// <summary>
    /// Points the shortcuts of <paramref name="target"/> with these arguments at an icon, and tells the taskbar.
    /// Other programs' shortcuts, and another install's, are left alone. Returns the ones that changed.
    /// </summary>
    public static List<string> SetIcons(IEnumerable<KeyValuePair<string, bool>> folders, string target, string arguments, string icon)
    {
        var changed = new List<string>();
        foreach (KeyValuePair<string, bool> folder in folders)
        {
            if (!Directory.Exists(folder.Key))
            {
                continue;
            }
            var depth = folder.Value ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
            foreach (string lnk in Directory.GetFiles(folder.Key, "*.lnk", depth))
            {
                try
                {
                    if (SetIcon(lnk, target, arguments, icon))
                    {
                        SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, lnk, IntPtr.Zero);
                        changed.Add(lnk);
                    }
                }
                catch (Exception e)
                {
                    // A broken shortcut of any program must not stop the others.
                    if (!(e is COMException || e is IOException || e is UnauthorizedAccessException))
                    {
                        throw;
                    }
                }
            }
        }
        if (changed.Count > 0)
        {
            SHChangeNotify(SHCNE_ASSOCCHANGED, 0, null, IntPtr.Zero);
        }
        return changed;
    }

    static bool SetIcon(string lnk, string target, string arguments, string icon)
    {
        var link = (IShellLinkW)new ShellLink();
        ((IPersistFile)link).Load(lnk, STGM_READ);
        var text = new StringBuilder(4096);
        link.GetPath(text, text.Capacity, IntPtr.Zero, 0);
        if (!string.Equals(text.ToString(), target, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        text.Clear();
        link.GetArguments(text, text.Capacity);
        if (Plain(text.ToString()) != Plain(arguments))
        {
            return false;
        }
        int index;
        text.Clear();
        link.GetIconLocation(text, text.Capacity, out index);
        if (index == 0 && string.Equals(text.ToString(), icon, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }
        link.SetIconLocation(icon, 0);
        ((IPersistFile)link).Save(lnk, true);
        return true;
    }

    /// <summary>Sets one string property and commits it.</summary>
    internal static void SetString(IPropertyStore store, Guid format, uint id, string text)
    {
        var key = new PropertyKey { FormatId = format, PropertyId = id };
        var value = new PropVariant { Type = VT_LPWSTR, Value = Marshal.StringToCoTaskMemUni(text) };
        try
        {
            store.SetValue(ref key, ref value);
            store.Commit();
        }
        finally
        {
            Marshal.FreeCoTaskMem(value.Value);
        }
    }
}
