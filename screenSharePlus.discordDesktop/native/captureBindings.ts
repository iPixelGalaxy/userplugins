/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const captureBindings = String.raw`
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)] public struct CaptureVideo {
    [MarshalAs(UnmanagedType.LPUTF8Str)] public string Graphics;
    public uint FpsNumerator, FpsDenominator, BaseWidth, BaseHeight, OutputWidth, OutputHeight;
    public int Format;
    public uint Adapter;
    [MarshalAs(UnmanagedType.I1)] public bool GpuConversion;
    public int ColorSpace, Range, Scale;
}
[StructLayout(LayoutKind.Sequential)] public struct CaptureAudio { public uint Rate; public int Speakers; }
[StructLayout(LayoutKind.Sequential)] public struct CaptureDisplay {
    public IntPtr Window;
    public uint Width, Height, BackBuffers;
    public int Format, DepthStencil, Adapter;
}
[StructLayout(LayoutKind.Sequential)] public struct CaptureSize { public float X, Y; }
[StructLayout(LayoutKind.Sequential)] public struct CaptureRectangle { public int Left, Top, Right, Bottom; }

public static class CaptureNative {
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out CaptureRectangle rectangle);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void Draw(IntPtr data, uint width, uint height);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool obs_startup([MarshalAs(UnmanagedType.LPUTF8Str)] string locale, [MarshalAs(UnmanagedType.LPUTF8Str)] string config, IntPtr profiler);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_add_data_path([MarshalAs(UnmanagedType.LPUTF8Str)] string path);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern int obs_reset_video(ref CaptureVideo video);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool obs_reset_audio(ref CaptureAudio audio);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern int obs_open_module(out IntPtr module, [MarshalAs(UnmanagedType.LPUTF8Str)] string binary, [MarshalAs(UnmanagedType.LPUTF8Str)] string data);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool obs_init_module(IntPtr module);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_post_load_modules();
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_get_latest_input_type_id([MarshalAs(UnmanagedType.LPUTF8Str)] string id);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_get_source_properties(IntPtr id);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_properties_get(IntPtr properties, [MarshalAs(UnmanagedType.LPUTF8Str)] string name);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern UIntPtr obs_property_list_item_count(IntPtr property);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_property_list_item_name(IntPtr property, UIntPtr index);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_property_list_item_string(IntPtr property, UIntPtr index);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_properties_destroy(IntPtr properties);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_data_create();
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_data_set_string(IntPtr data, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.LPUTF8Str)] string value);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_data_set_int(IntPtr data, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, long value);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_data_set_bool(IntPtr data, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, [MarshalAs(UnmanagedType.I1)] bool value);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_data_release(IntPtr data);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_source_create_private(IntPtr id, [MarshalAs(UnmanagedType.LPUTF8Str)] string name, IntPtr settings);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_scene_create_private([MarshalAs(UnmanagedType.LPUTF8Str)] string name);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_scene_get_source(IntPtr scene);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_scene_add(IntPtr scene, IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_sceneitem_set_bounds_type(IntPtr item, int type);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_sceneitem_set_bounds(IntPtr item, ref CaptureSize bounds);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_sceneitem_set_alignment(IntPtr item, uint alignment);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_source_inc_showing(IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_source_dec_showing(IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_source_release(IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern uint obs_source_get_width(IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern uint obs_source_get_height(IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_source_update(IntPtr source, IntPtr settings);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_enter_graphics();
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_leave_graphics();
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_scene_release(IntPtr scene);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_transition_set(IntPtr transition, IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool obs_transition_start(IntPtr transition, int mode, uint duration, IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_set_output_source(uint channel, IntPtr source);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr obs_display_create(ref CaptureDisplay display, uint background);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_display_add_draw_callback(IntPtr display, Draw draw, IntPtr data);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_display_remove_draw_callback(IntPtr display, Draw draw, IntPtr data);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_display_destroy(IntPtr display);
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_render_main_texture();
    [DllImport("obs.dll", CallingConvention=CallingConvention.Cdecl)] public static extern void obs_shutdown();
}
`;
