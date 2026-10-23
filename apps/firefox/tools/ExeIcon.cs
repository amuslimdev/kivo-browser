// بيبدّل كل أيقونات الـ exe (RT_GROUP_ICON) بأيقونة واحدة من ملف .ico، ويشيل الصور القديمة (RT_ICON).
// الـ artifact build بييجي بـ firefox.exe عليه أيقونة Firefox، وماينفعش نوزّعه بيها (trademark).
// package.ps1 بيحمّله بـ Add-Type، فلازم يتعمله compile بـ C# 5 بتاع Windows PowerShell.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class KivoExeIcon
{
    const uint LOAD_LIBRARY_AS_DATAFILE = 0x2;
    static readonly IntPtr RT_ICON = (IntPtr)3;
    static readonly IntPtr RT_GROUP_ICON = (IntPtr)14;

    delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);

    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32")]
    static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc callback, IntPtr param);
    [DllImport("kernel32", CharSet = CharSet.Unicode)]
    static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc callback, IntPtr param);
    [DllImport("kernel32")]
    static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort lang);
    [DllImport("kernel32")]
    static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32")]
    static extern IntPtr LockResource(IntPtr data);
    [DllImport("kernel32")]
    static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
    [DllImport("kernel32", SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr update, bool discard);

    class Group
    {
        public IntPtr Name;   // رقم، أو string متخزن في HGlobal لحد ما نخلص
        public ushort Lang;
    }

    static bool IsIntResource(IntPtr name) { return ((ulong)name.ToInt64() >> 16) == 0; }

    /// <returns>عدد الـ groups اللي اتبدلت.</returns>
    public static int Replace(string exePath, string icoPath)
    {
        byte[] ico = File.ReadAllBytes(icoPath);
        if (BitConverter.ToUInt16(ico, 2) != 1) throw new InvalidDataException("not an .ico file: " + icoPath);
        int count = BitConverter.ToUInt16(ico, 4);

        var groups = new List<Group>();
        var oldIcons = new List<KeyValuePair<ushort, ushort>>(); // (id، lang)
        int maxIconId = 0;

        IntPtr module = LoadLibraryEx(exePath, IntPtr.Zero, LOAD_LIBRARY_AS_DATAFILE);
        if (module == IntPtr.Zero) throw new IOException("LoadLibraryEx failed: " + Marshal.GetLastWin32Error());
        try
        {
            EnumResourceNames(module, RT_GROUP_ICON, delegate (IntPtr m, IntPtr t, IntPtr name, IntPtr p)
            {
                IntPtr stored = IsIntResource(name) ? name : Marshal.StringToHGlobalUni(Marshal.PtrToStringUni(name));
                EnumResourceLanguages(m, t, name, delegate (IntPtr m2, IntPtr t2, IntPtr n2, ushort lang, IntPtr p2)
                {
                    groups.Add(new Group { Name = stored, Lang = lang });
                    IntPtr res = FindResourceEx(m2, t2, n2, lang);
                    IntPtr data = LockResource(LoadResource(m2, res));
                    int size = (int)SizeofResource(m2, res);
                    byte[] dir = new byte[size];
                    Marshal.Copy(data, dir, 0, size);
                    int entries = BitConverter.ToUInt16(dir, 4);
                    for (int i = 0; i < entries; i++)
                    {
                        ushort id = BitConverter.ToUInt16(dir, 6 + i * 14 + 12);
                        oldIcons.Add(new KeyValuePair<ushort, ushort>(id, lang));
                    }
                    return true;
                }, IntPtr.Zero);
                return true;
            }, IntPtr.Zero);

            EnumResourceNames(module, RT_ICON, delegate (IntPtr m, IntPtr t, IntPtr name, IntPtr p)
            {
                if (IsIntResource(name)) maxIconId = Math.Max(maxIconId, (int)name.ToInt64());
                return true;
            }, IntPtr.Zero);
        }
        finally
        {
            FreeLibrary(module);
        }

        if (groups.Count == 0) throw new InvalidDataException("no icon groups in " + exePath);

        IntPtr update = BeginUpdateResource(exePath, false);
        if (update == IntPtr.Zero) throw new IOException("BeginUpdateResource failed: " + Marshal.GetLastWin32Error());
        bool ok = false;
        try
        {
            foreach (var icon in oldIcons)
            {
                // ممكن نفس الصورة تبقى في أكتر من group، والحذف التاني بيفشل عادي.
                UpdateResource(update, RT_ICON, (IntPtr)icon.Key, icon.Value, null, 0);
            }

            ushort lang = groups[0].Lang;
            var group = new MemoryStream();
            var writer = new BinaryWriter(group);
            writer.Write((ushort)0);
            writer.Write((ushort)1);
            writer.Write((ushort)count);
            for (int i = 0; i < count; i++)
            {
                int entry = 6 + i * 16;
                int bytes = BitConverter.ToInt32(ico, entry + 8);
                int offset = BitConverter.ToInt32(ico, entry + 12);
                ushort id = (ushort)(maxIconId + 1 + i);
                byte[] image = new byte[bytes];
                Buffer.BlockCopy(ico, offset, image, 0, bytes);
                if (!UpdateResource(update, RT_ICON, (IntPtr)id, lang, image, (uint)bytes))
                    throw new IOException("UpdateResource RT_ICON failed: " + Marshal.GetLastWin32Error());
                writer.Write(ico, entry, 12);   // width، height، colors، reserved، planes، bit count، bytes
                writer.Write(id);
            }
            writer.Flush();
            byte[] groupData = group.ToArray();

            foreach (var g in groups)
            {
                if (!UpdateResource(update, RT_GROUP_ICON, g.Name, g.Lang, groupData, (uint)groupData.Length))
                    throw new IOException("UpdateResource RT_GROUP_ICON failed: " + Marshal.GetLastWin32Error());
            }
            ok = true;
        }
        finally
        {
            if (!EndUpdateResource(update, !ok) && ok)
                throw new IOException("EndUpdateResource failed: " + Marshal.GetLastWin32Error());
            // نفس الاسم ممكن يتكرر بأكتر من لغة، فبنحرر كل string مرة واحدة.
            var freed = new HashSet<IntPtr>();
            foreach (var g in groups)
                if (!IsIntResource(g.Name) && freed.Add(g.Name)) Marshal.FreeHGlobal(g.Name);
        }
        return groups.Count;
    }
}
