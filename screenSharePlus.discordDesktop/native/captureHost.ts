/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const captureHost = String.raw`
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

public sealed class CaptureMonitor {
    public string id { get; set; }
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
}
public sealed class CaptureCommand {
    public string id { get; set; }
    public string root { get; set; }
    public string window { get; set; }
    public uint fps { get; set; }
    public int method { get; set; }
    public int sequence { get; set; }
    public CaptureMonitor[] monitors { get; set; }
}
public sealed class CaptureWindow : Form {
    private readonly Dictionary<string, IntPtr> inputs = new Dictionary<string, IntPtr>();
    private readonly Dictionary<string, IntPtr> scenes = new Dictionary<string, IntPtr>();
    private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
    private readonly CaptureNative.Draw draw;
    private readonly Size captureSize;
    private readonly int captureMethod;
    private readonly bool desktopCapture;
    private readonly Dictionary<string, long> missingFrames = new Dictionary<string, long>();
    private readonly HashSet<string> dxgiFallbacks = new HashSet<string>();
    private readonly System.Windows.Forms.Timer frameTimer = new System.Windows.Forms.Timer { Interval = 250 };
    private readonly Stopwatch captureClock = new Stopwatch();
    private int preparationTotal;
    private bool captureReady;
    private IntPtr display, transition;
    private bool initialized;
    private string activeId;

    public CaptureWindow(CaptureCommand command) {
        captureMethod = command.method;
        desktopCapture = command.window == null;
        Text = "ScreenSharePlus Capture";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        if (command.window == null) {
            CaptureMonitor largest = command.monitors.OrderByDescending(monitor => (long)monitor.width * monitor.height).First();
            captureSize = new Size(largest.width, largest.height);
        } else {
            CaptureRectangle rectangle;
            if (!CaptureNative.GetClientRect(new IntPtr(long.Parse(command.window)), out rectangle) || rectangle.Right < 2 || rectangle.Bottom < 2)
                throw new InvalidOperationException("Window unavailable.");
            captureSize = new Size(rectangle.Right, rectangle.Bottom);
        }
        ClientSize = captureSize;
        Location = new Point(SystemInformation.VirtualScreen.Left - captureSize.Width * 2, SystemInformation.VirtualScreen.Top - captureSize.Height * 2);
        draw = (data, width, height) => CaptureNative.obs_render_main_texture();
    }
    protected override bool ShowWithoutActivation { get { return true; } }

    private static string TextAt(IntPtr pointer) {
        int length = 0;
        while (Marshal.ReadByte(pointer, length) != 0) length++;
        byte[] bytes = new byte[length];
        Marshal.Copy(pointer, bytes, 0, length);
        return Encoding.UTF8.GetString(bytes);
    }
    private void Emit(object message) {
        Console.WriteLine("ScreenSharePlus:" + serializer.Serialize(message));
        Console.Out.Flush();
    }
    private void Progress(string status, int completed, int total) {
        Emit(new { type = "progress", status, completed, total });
    }
    private void Prepare(CaptureMonitor[] allowed, bool report) {
        IntPtr kind = CaptureNative.obs_get_latest_input_type_id("monitor_capture");
        IntPtr properties = CaptureNative.obs_get_source_properties(kind);
        try {
            IntPtr list = CaptureNative.obs_properties_get(properties, "monitor_id");
            ulong count = CaptureNative.obs_property_list_item_count(list).ToUInt64();
            foreach (CaptureMonitor monitor in allowed) {
                if (inputs.ContainsKey(monitor.id)) continue;
                string geometry = monitor.width + "x" + monitor.height + " @ " + monitor.x + "," + monitor.y;
                string device = null;
                for (ulong index = 0; index < count; index++) {
                    if (!TextAt(CaptureNative.obs_property_list_item_name(list, new UIntPtr(index))).Contains(geometry)) continue;
                    if (device != null) throw new InvalidOperationException("Ambiguous monitor.");
                    device = TextAt(CaptureNative.obs_property_list_item_string(list, new UIntPtr(index)));
                }
                if (device == null) throw new InvalidOperationException("Monitor unavailable.");
                IntPtr settings = CaptureNative.obs_data_create();
                IntPtr source;
                try {
                    CaptureNative.obs_data_set_string(settings, "monitor_id", device);
                    CaptureNative.obs_data_set_int(settings, "method", captureMethod);
                    CaptureNative.obs_data_set_bool(settings, "capture_cursor", true);
                    CaptureNative.obs_data_set_bool(settings, "force_sdr", true);
                    source = CaptureNative.obs_source_create_private(kind, "ScreenSharePlus " + monitor.id, settings);
                } finally { CaptureNative.obs_data_release(settings); }
                if (source == IntPtr.Zero) throw new InvalidOperationException("Capture unavailable.");
                inputs.Add(monitor.id, source);
                CaptureNative.obs_source_inc_showing(source);
                IntPtr scene = CaptureNative.obs_scene_create_private("ScreenSharePlus scene " + monitor.id);
                if (scene == IntPtr.Zero) throw new InvalidOperationException("Scene unavailable.");
                scenes.Add(monitor.id, scene);
                IntPtr item = CaptureNative.obs_scene_add(scene, source);
                CaptureSize bounds = new CaptureSize { X = captureSize.Width, Y = captureSize.Height };
                CaptureNative.obs_sceneitem_set_bounds_type(item, 2);
                CaptureNative.obs_sceneitem_set_bounds(item, ref bounds);
                CaptureNative.obs_sceneitem_set_alignment(item, 5);
                if (report) Progress("Preparing monitor " + inputs.Count + " of " + allowed.Length + ".", 3 + inputs.Count, allowed.Length + 5);
            }
        } finally { CaptureNative.obs_properties_destroy(properties); }
    }
    private void Select(CaptureCommand command) {
        if (!command.monitors.Any(monitor => monitor.id == command.id)) throw new InvalidOperationException("Monitor ignored.");
        Prepare(command.monitors, false);
        bool cut = activeId == null || !command.monitors.Any(monitor => monitor.id == activeId);
        IntPtr target = CaptureNative.obs_scene_get_source(scenes[command.id]);
        if (cut) CaptureNative.obs_transition_set(transition, target);
        else if (command.id != activeId && !CaptureNative.obs_transition_start(transition, 0, 120, target))
            throw new InvalidOperationException("Transition unavailable.");
        activeId = command.id;
        foreach (string id in inputs.Keys.ToArray()) {
            if (command.monitors.Any(monitor => monitor.id == id)) continue;
            CaptureNative.obs_scene_release(scenes[id]);
            scenes.Remove(id);
            CaptureNative.obs_source_dec_showing(inputs[id]);
            CaptureNative.obs_source_release(inputs[id]);
            inputs.Remove(id);
            missingFrames.Remove(id);
            dxgiFallbacks.Remove(id);
        }
    }
    private void PrepareWindow(CaptureCommand command) {
        IntPtr window = new IntPtr(long.Parse(command.window));
        var title = new StringBuilder(4096);
        var className = new StringBuilder(256);
        uint processId;
        CaptureNative.GetWindowText(window, title, title.Capacity);
        CaptureNative.GetClassName(window, className, className.Capacity);
        CaptureNative.GetWindowThreadProcessId(window, out processId);
        string executable;
        using (Process process = Process.GetProcessById((int)processId)) executable = process.ProcessName + ".exe";
        string selection = string.Join(":", new [] { title.ToString(), className.ToString(), executable }.Select(value => value.Replace("#", "#22").Replace(":", "#3A")));
        IntPtr settings = CaptureNative.obs_data_create();
        IntPtr source;
        try {
            CaptureNative.obs_data_set_string(settings, "window", selection);
            CaptureNative.obs_data_set_int(settings, "method", captureMethod == 0 ? 0 : 2);
            CaptureNative.obs_data_set_int(settings, "priority", 0);
            CaptureNative.obs_data_set_bool(settings, "cursor", true);
            CaptureNative.obs_data_set_bool(settings, "capture_audio", false);
            CaptureNative.obs_data_set_bool(settings, "force_sdr", true);
            source = CaptureNative.obs_source_create_private(CaptureNative.obs_get_latest_input_type_id("window_capture"), "ScreenSharePlus window", settings);
        } finally { CaptureNative.obs_data_release(settings); }
        if (source == IntPtr.Zero) throw new InvalidOperationException("Window capture unavailable.");
        inputs.Add("window", source);
        CaptureNative.obs_source_inc_showing(source);
        IntPtr scene = CaptureNative.obs_scene_create_private("ScreenSharePlus window scene");
        if (scene == IntPtr.Zero) throw new InvalidOperationException("Window scene unavailable.");
        scenes.Add("window", scene);
        IntPtr item = CaptureNative.obs_scene_add(scene, source);
        CaptureSize bounds = new CaptureSize { X = captureSize.Width, Y = captureSize.Height };
        CaptureNative.obs_sceneitem_set_bounds_type(item, 2);
        CaptureNative.obs_sceneitem_set_bounds(item, ref bounds);
        CaptureNative.obs_sceneitem_set_alignment(item, 5);
    }
    private void Initialize(CaptureCommand command) {
        int total = command.monitors.Length + 5;
        Progress("Starting capture engine.", 0, total);
        if (!CaptureNative.obs_startup("en-US", Path.Combine(command.root, "config", "ScreenSharePlus"), IntPtr.Zero))
            throw new InvalidOperationException("Engine unavailable.");
        initialized = true;
        CaptureNative.obs_add_data_path(Path.Combine(command.root, "data", "libobs"));
        CaptureVideo video = new CaptureVideo {
            Graphics = "libobs-d3d11.dll", FpsNumerator = command.fps, FpsDenominator = 1,
            BaseWidth = (uint)captureSize.Width, BaseHeight = (uint)captureSize.Height,
            OutputWidth = (uint)captureSize.Width, OutputHeight = (uint)captureSize.Height,
            Format = 7, GpuConversion = false, ColorSpace = 2, Range = 2, Scale = 1
        };
        if (CaptureNative.obs_reset_video(ref video) != 0) throw new InvalidOperationException("Graphics unavailable.");
        CaptureAudio audio = new CaptureAudio { Rate = 48000, Speakers = 2 };
        if (!CaptureNative.obs_reset_audio(ref audio)) throw new InvalidOperationException("Audio initialization failed.");
        Progress("Loading capture libraries.", 1, total);
        foreach (string name in new [] { "win-capture", "obs-transitions" }) {
            IntPtr module;
            if (CaptureNative.obs_open_module(out module, Path.Combine(command.root, "obs-plugins", "64bit", name + ".dll"),
                Path.Combine(command.root, "data", "obs-plugins", name)) != 0 || !CaptureNative.obs_init_module(module))
                throw new InvalidOperationException("Capture module unavailable.");
        }
        CaptureNative.obs_post_load_modules();
        Progress("Matching allowed monitors.", 2, total);
        if (command.window == null) Prepare(command.monitors, true);
        else PrepareWindow(command);
        byte[] fadeId = Encoding.UTF8.GetBytes("fade_transition\0");
        IntPtr fade = Marshal.AllocHGlobal(fadeId.Length);
        try {
            Marshal.Copy(fadeId, 0, fade, fadeId.Length);
            transition = CaptureNative.obs_source_create_private(fade, "ScreenSharePlus fade", IntPtr.Zero);
        } finally { Marshal.FreeHGlobal(fade); }
        if (transition == IntPtr.Zero) throw new InvalidOperationException("Fade unavailable.");
        if (command.window == null) Select(command);
        else CaptureNative.obs_transition_set(transition, CaptureNative.obs_scene_get_source(scenes["window"]));
        CaptureNative.obs_set_output_source(0, transition);
        Progress("Preparing shared video.", total - 1, total);
        CaptureDisplay graphics = new CaptureDisplay { Window = Handle, Width = (uint)captureSize.Width, Height = (uint)captureSize.Height, BackBuffers = 2, Format = 5 };
        display = CaptureNative.obs_display_create(ref graphics, 0);
        if (display == IntPtr.Zero) throw new InvalidOperationException("Display unavailable.");
        CaptureNative.obs_display_add_draw_callback(display, draw, IntPtr.Zero);
        Progress("Waiting for capture frames.", total - 1, total);
        preparationTotal = total;
        captureClock.Start();
        frameTimer.Tick += CheckFrames;
        frameTimer.Start();
    }
    private void CheckFrames(object sender, EventArgs args) {
        long now = captureClock.ElapsedMilliseconds;
        bool allReady = true;
        foreach (var input in inputs) {
            bool hasFrame;
            CaptureNative.obs_enter_graphics();
            try { hasFrame = CaptureNative.obs_source_get_width(input.Value) > 0 && CaptureNative.obs_source_get_height(input.Value) > 0; }
            finally { CaptureNative.obs_leave_graphics(); }
            if (hasFrame) { missingFrames.Remove(input.Key); continue; }
            allReady = false;
            if (!desktopCapture || captureMethod != 2 || dxgiFallbacks.Contains(input.Key)) continue;
            long since;
            if (!missingFrames.TryGetValue(input.Key, out since)) { missingFrames[input.Key] = now; continue; }
            if (now - since < 3000) continue;
            IntPtr settings = CaptureNative.obs_data_create();
            try {
                CaptureNative.obs_data_set_int(settings, "method", 1);
                CaptureNative.obs_source_update(input.Value, settings);
            } finally { CaptureNative.obs_data_release(settings); }
            dxgiFallbacks.Add(input.Key);
            missingFrames.Remove(input.Key);
            if (!captureReady) Progress("WGC unavailable. Preparing DXGI display capture.", preparationTotal - 1, preparationTotal);
        }
        if (captureReady) return;
        if (allReady) {
            captureReady = true;
            if (!desktopCapture || captureMethod != 2) frameTimer.Stop();
            Progress("Ready to share.", preparationTotal, preparationTotal);
            Emit(new { type = "ready", sourceId = "window:" + Handle.ToInt64() + ":0" });
            new Thread(ReadCommands) { IsBackground = true }.Start();
        } else if (now >= 12000) {
            Emit(new { type = "error", sequence = 0 });
            Close();
        }
    }
    private void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            CaptureCommand command;
            try { command = serializer.Deserialize<CaptureCommand>(line); }
            catch { Emit(new { type = "error", sequence = 0 }); continue; }
            BeginInvoke(new Action(() => {
                try { Select(command); Emit(new { type = "updated", sequence = command.sequence }); }
                catch { Emit(new { type = "error", sequence = command.sequence }); }
            }));
        }
        if (!IsDisposed) BeginInvoke(new Action(Close));
    }
    protected override void OnFormClosed(FormClosedEventArgs args) {
        frameTimer.Stop();
        frameTimer.Tick -= CheckFrames;
        frameTimer.Dispose();
        if (display != IntPtr.Zero) {
            CaptureNative.obs_display_remove_draw_callback(display, draw, IntPtr.Zero);
            CaptureNative.obs_display_destroy(display);
        }
        if (initialized) {
            CaptureNative.obs_set_output_source(0, IntPtr.Zero);
            if (transition != IntPtr.Zero) CaptureNative.obs_source_release(transition);
            foreach (IntPtr scene in scenes.Values) CaptureNative.obs_scene_release(scene);
            foreach (IntPtr source in inputs.Values) {
                CaptureNative.obs_source_dec_showing(source);
                CaptureNative.obs_source_release(source);
            }
            CaptureNative.obs_shutdown();
        }
        base.OnFormClosed(args);
    }
    [STAThread] public static void Main(string[] args) {
        CaptureNative.SetProcessDpiAwarenessContext(new IntPtr(-4));
        CaptureCommand configuration = new JavaScriptSerializer().Deserialize<CaptureCommand>(File.ReadAllText(args[0]));
        CaptureWindow window = new CaptureWindow(configuration);
        window.Shown += (sender, eventArgs) => {
            try { window.Initialize(configuration); }
            catch { window.Emit(new { type = "error", sequence = 0 }); window.Close(); }
        };
        Application.Run(window);
    }
}
`;
