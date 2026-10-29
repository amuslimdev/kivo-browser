// "Kivo.exe --kivo-jumplist <file>": writes the Jump Lists (right click on a Kivo taskbar button) that
// KivoTaskbar.sys.mjs describes in <file>. Each Kivo profile but the main one has its own taskbar button and
// AppUserModelID, and Firefox's Jump List builder only writes the list of its own process's AppUserModelID,
// with a single custom category. The items start this Kivo.exe, so they open with Kivo's identity.
//
// <file> is UTF-8, one entry per line, fields split by tabs:
//   app <AppUserModelID>     starts a list; a list with no items is deleted
//   category <title>         the items after it go in this custom category
//   tasks                    the items after it go in Tasks
//   item <title> <arguments> <icon file> <icon index> <tooltip>
// Windows refuses an item the user removed from the list since it was last written, so those are left out
// and printed as "removed<TAB><AppUserModelID><TAB><arguments>". Failures are printed as "error<TAB>...".
// Kept ASCII and C# 5, like Launcher.cs.
using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

static class KivoJumpList
{
    public const string Flag = "--kivo-jumplist";

    [ComImport, Guid("77F10CF0-3DB5-4966-B520-B7C54FD35ED6")]
    class DestinationList { }

    [ComImport, Guid("2D3468C1-36A7-43B6-AC24-D3F02FD9607A")]
    class EnumerableObjectCollection { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("6332DEBF-87B5-4670-90C0-5E57B408A49E")]
    interface ICustomDestinationList
    {
        void SetAppID([MarshalAs(UnmanagedType.LPWStr)] string id);
        void BeginList(out uint minSlots, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        [PreserveSig]
        int AppendCategory([MarshalAs(UnmanagedType.LPWStr)] string title, IObjectArray items);
        void AppendKnownCategory(int category);
        void AddUserTasks(IObjectArray tasks);
        void CommitList();
        void GetRemovedDestinations(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object removed);
        void DeleteList([MarshalAs(UnmanagedType.LPWStr)] string id);
        void AbortList();
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("92CA9DCD-5622-4BBA-A805-5E9F541BD8C9")]
    interface IObjectArray
    {
        void GetCount(out uint count);
        void GetAt(uint index, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object item);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5632B1A4-E38A-400A-928A-D4CD63230295")]
    interface IObjectCollection
    {
        void GetCount(out uint count);
        void GetAt(uint index, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object item);
        void AddObject([MarshalAs(UnmanagedType.Interface)] object item);
        void AddFromArray(IObjectArray items);
        void RemoveObjectAt(uint index);
        void Clear();
    }

    class Item
    {
        public string Title, Arguments, Icon, Tooltip;
        public int IconIndex;
    }

    /// <summary>A custom category, or Tasks when Title is null.</summary>
    class Group
    {
        public string Title;
        public List<Item> Items = new List<Item>();
    }

    class AppList
    {
        public string Id;
        public List<Group> Groups = new List<Group>();
    }

    // PKEY_Title, the item's name in the list.
    static readonly Guid TitleFormat = new Guid("F29F85E0-4FF9-1068-AB91-08002B27B3D9");

    public static bool IsRun(string arguments)
    {
        return arguments.StartsWith(Flag + " ", StringComparison.Ordinal);
    }

    public static int Write(string arguments)
    {
        int failed = 0;
        try
        {
            string file = arguments.Substring(Flag.Length).Trim().Trim('"');
            string exe = Assembly.GetExecutingAssembly().Location;
            foreach (AppList app in Read(file))
            {
                try
                {
                    WriteList(app, exe);
                }
                catch (Exception e)
                {
                    failed++;
                    Console.WriteLine("error\t" + app.Id + "\t" + e.Message);
                }
            }
        }
        catch (Exception e)
        {
            failed++;
            Console.WriteLine("error\t\t" + e.Message);
        }
        Console.Out.Flush();
        return failed == 0 ? 0 : 1;
    }

    static List<AppList> Read(string file)
    {
        var apps = new List<AppList>();
        AppList app = null;
        Group group = null;
        foreach (string line in File.ReadAllLines(file, Encoding.UTF8))
        {
            string[] fields = line.Split('\t');
            if (fields[0] == "app" && fields.Length > 1)
            {
                app = new AppList { Id = fields[1] };
                apps.Add(app);
                group = null;
            }
            else if (app == null)
            {
                continue;
            }
            else if (fields[0] == "category" && fields.Length > 1)
            {
                group = new Group { Title = fields[1] };
                app.Groups.Add(group);
            }
            else if (fields[0] == "tasks")
            {
                group = new Group();
                app.Groups.Add(group);
            }
            else if (fields[0] == "item" && group != null && fields.Length >= 6)
            {
                int index;
                int.TryParse(fields[4], out index);
                group.Items.Add(new Item { Title = fields[1], Arguments = fields[2], Icon = fields[3], IconIndex = index, Tooltip = fields[5] });
            }
        }
        return apps;
    }

    static void WriteList(AppList app, string exe)
    {
        var list = (ICustomDestinationList)new DestinationList();
        list.SetAppID(app.Id);
        if (app.Groups.TrueForAll(g => g.Items.Count == 0))
        {
            list.DeleteList(app.Id);
            return;
        }

        uint slots;
        object removedItems;
        Guid arrayId = typeof(IObjectArray).GUID;
        list.BeginList(out slots, ref arrayId, out removedItems);
        try
        {
            HashSet<string> removed = RemovedArguments((IObjectArray)removedItems);
            foreach (string arguments in removed)
            {
                Console.WriteLine("removed\t" + app.Id + "\t" + arguments);
            }
            foreach (Group group in app.Groups)
            {
                var items = (IObjectCollection)new EnumerableObjectCollection();
                foreach (Item item in group.Items)
                {
                    // Tasks can't be removed by the user, only items in a category.
                    if (group.Title == null || !removed.Contains(item.Arguments))
                    {
                        items.AddObject(Link(item, exe));
                    }
                }
                uint count;
                items.GetCount(out count);
                if (count == 0)
                {
                    continue;
                }
                if (group.Title == null)
                {
                    list.AddUserTasks((IObjectArray)items);
                    continue;
                }
                // E_ACCESSDENIED when "Show recently opened items in Jump Lists" is off in Windows settings.
                // The other categories and the tasks still go in.
                int result = list.AppendCategory(group.Title, (IObjectArray)items);
                if (result < 0)
                {
                    Console.WriteLine("error\t" + app.Id + "\t" + group.Title + ": 0x" + result.ToString("X8"));
                }
            }
            list.CommitList();
        }
        catch
        {
            list.AbortList();
            throw;
        }
    }

    static HashSet<string> RemovedArguments(IObjectArray removed)
    {
        var arguments = new HashSet<string>();
        if (removed == null)
        {
            return arguments;
        }
        uint count;
        removed.GetCount(out count);
        Guid linkId = typeof(KivoShortcut.IShellLinkW).GUID;
        for (uint i = 0; i < count; i++)
        {
            object item;
            try
            {
                removed.GetAt(i, ref linkId, out item);
            }
            catch (COMException)
            {
                continue; // Not a link, so not one of Kivo's items.
            }
            var text = new StringBuilder(4096);
            ((KivoShortcut.IShellLinkW)item).GetArguments(text, text.Capacity);
            arguments.Add(text.ToString());
        }
        return arguments;
    }

    static object Link(Item item, string exe)
    {
        var link = (KivoShortcut.IShellLinkW)new KivoShortcut.ShellLink();
        link.SetPath(exe);
        link.SetArguments(item.Arguments);
        link.SetWorkingDirectory(Path.GetDirectoryName(exe));
        if (item.Icon.Length > 0)
        {
            link.SetIconLocation(item.Icon, item.IconIndex);
        }
        link.SetDescription(item.Tooltip);
        KivoShortcut.SetString((KivoShortcut.IPropertyStore)link, TitleFormat, 2, item.Title);
        return link;
    }
}
