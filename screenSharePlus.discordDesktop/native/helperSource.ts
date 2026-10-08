/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Background capture helper. It captures one monitor with Windows Graphics Capture, crossfades to the next monitor
// on the GPU, and presents the result to an off-screen window that Discord captures. Compiled on the user's machine.
export const helperSource = String.raw`
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Windows.Graphics;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;

public sealed class CaptureRegion {
    public int x { get; set; }
    public int y { get; set; }
    public int width { get; set; }
    public int height { get; set; }
}

public sealed class CaptureCommand {
    public int sequence { get; set; }
    public CaptureRegion monitor { get; set; }
    public int width { get; set; }
    public int height { get; set; }
    public int fps { get; set; }
    public int fade { get; set; }
}

[StructLayout(LayoutKind.Sequential)] public struct TextureDesc { public uint Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage, BindFlags, CpuAccess, Misc; }
[StructLayout(LayoutKind.Sequential)] public struct BufferDesc { public uint ByteWidth, Usage, BindFlags, CpuAccess, Misc, Stride; }
[StructLayout(LayoutKind.Sequential)] public struct SamplerDesc { public int Filter, AddressU, AddressV, AddressW; public float LodBias; public uint Anisotropy; public int Comparison; public float B0, B1, B2, B3, MinLod, MaxLod; }
[StructLayout(LayoutKind.Sequential)] public struct Viewport { public float X, Y, Width, Height, MinDepth, MaxDepth; }
[StructLayout(LayoutKind.Sequential)] public struct Box { public uint Left, Top, Front, Right, Bottom, Back; }
[StructLayout(LayoutKind.Sequential)] public struct SwapChainDesc { public uint Width, Height; public int Format, Stereo; public uint SampleCount, SampleQuality, Usage, BufferCount; public int Scaling, Effect, Alpha; public uint Flags; }
[StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }

public static class Gpu {
    [DllImport("d3d11.dll")] public static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr levels, uint count, uint sdk, out IntPtr device, out int level, out IntPtr context);
    [DllImport("d3d11.dll")] public static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);
    [DllImport("dxgi.dll")] public static extern int CreateDXGIFactory1(ref Guid iid, out IntPtr factory);
    [DllImport("d3dcompiler_47.dll")] public static extern int D3DCompile(byte[] source, IntPtr length, [MarshalAs(UnmanagedType.LPStr)] string name, IntPtr defines, IntPtr include,
        [MarshalAs(UnmanagedType.LPStr)] string entry, [MarshalAs(UnmanagedType.LPStr)] string target, uint flags, uint effectFlags, out IntPtr code, out IntPtr errors);
    [DllImport("combase.dll")] public static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
    [DllImport("combase.dll", CharSet = CharSet.Unicode)] public static extern int WindowsCreateString(string text, int length, out IntPtr value);
    [DllImport("combase.dll")] public static extern int WindowsDeleteString(IntPtr value);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromRect(ref Rect rect, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint period);

    public delegate int CreateTexture2D(IntPtr self, ref TextureDesc desc, IntPtr data, out IntPtr texture);
    public delegate int CreateView(IntPtr self, IntPtr resource, IntPtr desc, out IntPtr view);
    public delegate int CreateShader(IntPtr self, IntPtr code, IntPtr length, IntPtr linkage, out IntPtr shader);
    public delegate int CreateBuffer(IntPtr self, ref BufferDesc desc, IntPtr data, out IntPtr buffer);
    public delegate int CreateBlendState(IntPtr self, byte[] desc, out IntPtr state);
    public delegate int CreateSamplerState(IntPtr self, ref SamplerDesc desc, out IntPtr state);
    public delegate void SetResources(IntPtr self, uint start, uint count, IntPtr[] items);
    public delegate void SetShader(IntPtr self, IntPtr shader, IntPtr classes, uint count);
    public delegate void Draw(IntPtr self, uint count, uint start);
    public delegate void SetPointer(IntPtr self, IntPtr value);
    public delegate void SetTopology(IntPtr self, int topology);
    public delegate void SetTargets(IntPtr self, uint count, IntPtr[] views, IntPtr depth);
    public delegate void SetBlend(IntPtr self, IntPtr state, float[] factor, uint mask);
    public delegate void SetViewports(IntPtr self, uint count, ref Viewport viewport);
    public delegate void CopyRegion(IntPtr self, IntPtr target, uint targetIndex, uint x, uint y, uint z, IntPtr source, uint sourceIndex, ref Box box);
    public delegate void UpdateResource(IntPtr self, IntPtr target, uint index, IntPtr box, float[] data, uint row, uint depth);
    public delegate void ClearTarget(IntPtr self, IntPtr view, float[] color);
    public delegate int Present(IntPtr self, uint interval, uint flags);
    public delegate int GetBuffer(IntPtr self, uint index, ref Guid iid, out IntPtr surface);
    public delegate int CreateSwapChain(IntPtr self, IntPtr device, IntPtr window, ref SwapChainDesc desc, IntPtr fullscreen, IntPtr output, out IntPtr swapChain);
    public delegate int WindowAssociation(IntPtr self, IntPtr window, uint flags);
    public delegate int ThreadPriority(IntPtr self, int priority);
    public delegate IntPtr BlobValue(IntPtr self);
    public delegate int GetInterface(IntPtr self, ref Guid iid, out IntPtr result);
    public delegate void GetTextureDesc(IntPtr self, out TextureDesc desc);
    public delegate int CreateForMonitor(IntPtr self, IntPtr monitor, ref Guid iid, out IntPtr item);

    public static readonly Guid Texture2DId = new Guid("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    public static T Slot<T>(IntPtr target, int index) where T : class {
        IntPtr table = Marshal.ReadIntPtr(target);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table, index * IntPtr.Size), typeof(T)) as T;
    }

    public static void Check(int result, string action) {
        if (result < 0) throw new InvalidOperationException(action + " failed (0x" + result.ToString("X8") + ").");
    }

    public static void Release(ref IntPtr target) {
        if (target != IntPtr.Zero) Marshal.Release(target);
        target = IntPtr.Zero;
    }
}

public sealed class Renderer : IDisposable {
    const string Shader = @"
        struct Vertex { float4 position : SV_Position; float2 uv : TEXCOORD0; };
        cbuffer Layer : register(b0) { float opacity; float3 padding; };
        Texture2D image : register(t0);
        SamplerState linearSampler : register(s0);
        Vertex vs(uint id : SV_VertexID) {
            Vertex output;
            output.uv = float2((id << 1) & 2, id & 2);
            output.position = float4(output.uv * float2(2, -2) + float2(-1, 1), 0, 1);
            return output;
        }
        float4 ps(Vertex input) : SV_Target { return float4(image.Sample(linearSampler, input.uv).rgb * opacity, 1); }";

    public IntPtr Device, Context;
    public IDirect3DDevice CaptureDevice;
    IntPtr swapChain, target, vertexShader, pixelShader, constants, sampler, blend;
    readonly int width, height;
    Gpu.SetResources setShaderResources, setSamplers, setConstants;
    Gpu.SetShader setPixelShader, setVertexShader;
    Gpu.Draw draw;
    Gpu.SetPointer setInputLayout;
    Gpu.SetTopology setTopology;
    Gpu.SetTargets setTargets;
    Gpu.SetBlend setBlend;
    Gpu.SetViewports setViewports;
    Gpu.UpdateResource update;
    Gpu.ClearTarget clear;
    Gpu.Present present;
    public Gpu.CopyRegion CopyRegion;
    public Gpu.SetPointer GenerateMips;

    public Renderer(IntPtr window, int width, int height) {
        this.width = width;
        this.height = height;
        int level;
        Gpu.Check(Gpu.D3D11CreateDevice(IntPtr.Zero, 1, IntPtr.Zero, 0x20, IntPtr.Zero, 0, 7, out Device, out level, out Context), "Creating the graphics device");
        Guid dxgiId = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
        IntPtr dxgiDevice;
        Gpu.Check(Marshal.QueryInterface(Device, ref dxgiId, out dxgiDevice), "Reading the graphics device");
        try {
            Gpu.Slot<Gpu.ThreadPriority>(dxgiDevice, 10)(dxgiDevice, 7);
            IntPtr inspectable;
            Gpu.Check(Gpu.CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice, out inspectable), "Sharing the graphics device");
            CaptureDevice = (IDirect3DDevice)Marshal.GetObjectForIUnknown(inspectable);
            Marshal.Release(inspectable);
        } finally { Marshal.Release(dxgiDevice); }

        Guid factoryId = new Guid("50c83a1c-e072-4c48-87b0-3630fa36a6d0");
        IntPtr factory;
        Gpu.Check(Gpu.CreateDXGIFactory1(ref factoryId, out factory), "Creating the presentation factory");
        try {
            SwapChainDesc description = new SwapChainDesc { Width = (uint)width, Height = (uint)height, Format = 87, SampleCount = 1, Usage = 0x20, BufferCount = 2, Effect = 4 };
            Gpu.Check(Gpu.Slot<Gpu.CreateSwapChain>(factory, 15)(factory, Device, window, ref description, IntPtr.Zero, IntPtr.Zero, out swapChain), "Creating the presentation surface");
            Gpu.Slot<Gpu.WindowAssociation>(factory, 8)(factory, window, 2);
        } finally { Marshal.Release(factory); }

        Guid textureId = Gpu.Texture2DId;
        IntPtr buffer;
        Gpu.Check(Gpu.Slot<Gpu.GetBuffer>(swapChain, 9)(swapChain, 0, ref textureId, out buffer), "Reading the presentation surface");
        try { Gpu.Check(Gpu.Slot<Gpu.CreateView>(Device, 9)(Device, buffer, IntPtr.Zero, out target), "Creating the render target"); }
        finally { Marshal.Release(buffer); }

        vertexShader = CompileShader("vs", "vs_5_0", 12);
        pixelShader = CompileShader("ps", "ps_5_0", 15);
        BufferDesc constantDesc = new BufferDesc { ByteWidth = 16, BindFlags = 4 };
        Gpu.Check(Gpu.Slot<Gpu.CreateBuffer>(Device, 3)(Device, ref constantDesc, IntPtr.Zero, out constants), "Creating shader constants");
        SamplerDesc samplerDesc = new SamplerDesc { Filter = 0x15, AddressU = 3, AddressV = 3, AddressW = 3, Anisotropy = 1, Comparison = 1, MaxLod = float.MaxValue };
        Gpu.Check(Gpu.Slot<Gpu.CreateSamplerState>(Device, 23)(Device, ref samplerDesc, out sampler), "Creating the image sampler");
        byte[] blendDesc = new byte[8 + 8 * 32];
        int[] blendValues = { 1, 2, 2, 1, 1, 2, 1 };
        for (int target = 0; target < 8; target++) {
            for (int index = 0; index < blendValues.Length; index++) BitConverter.GetBytes(blendValues[index]).CopyTo(blendDesc, 8 + target * 32 + index * 4);
            blendDesc[8 + target * 32 + 28] = 0x0F;
        }
        Gpu.Check(Gpu.Slot<Gpu.CreateBlendState>(Device, 20)(Device, blendDesc, out blend), "Creating the fade blend");

        setShaderResources = Gpu.Slot<Gpu.SetResources>(Context, 8);
        setPixelShader = Gpu.Slot<Gpu.SetShader>(Context, 9);
        setSamplers = Gpu.Slot<Gpu.SetResources>(Context, 10);
        setVertexShader = Gpu.Slot<Gpu.SetShader>(Context, 11);
        draw = Gpu.Slot<Gpu.Draw>(Context, 13);
        setConstants = Gpu.Slot<Gpu.SetResources>(Context, 16);
        setInputLayout = Gpu.Slot<Gpu.SetPointer>(Context, 17);
        setTopology = Gpu.Slot<Gpu.SetTopology>(Context, 24);
        setTargets = Gpu.Slot<Gpu.SetTargets>(Context, 33);
        setBlend = Gpu.Slot<Gpu.SetBlend>(Context, 35);
        setViewports = Gpu.Slot<Gpu.SetViewports>(Context, 44);
        CopyRegion = Gpu.Slot<Gpu.CopyRegion>(Context, 46);
        update = Gpu.Slot<Gpu.UpdateResource>(Context, 48);
        clear = Gpu.Slot<Gpu.ClearTarget>(Context, 50);
        GenerateMips = Gpu.Slot<Gpu.SetPointer>(Context, 54);
        present = Gpu.Slot<Gpu.Present>(swapChain, 8);
    }

    IntPtr CompileShader(string entry, string profile, int slot) {
        byte[] source = Encoding.ASCII.GetBytes(Shader);
        IntPtr code, errors;
        int result = Gpu.D3DCompile(source, new IntPtr(source.Length), null, IntPtr.Zero, IntPtr.Zero, entry, profile, 1 << 15, 0, out code, out errors);
        if (errors != IntPtr.Zero) Marshal.Release(errors);
        Gpu.Check(result, "Compiling the fade shader");
        try {
            IntPtr shader;
            Gpu.Check(Gpu.Slot<Gpu.CreateShader>(Device, slot)(Device, Gpu.Slot<Gpu.BlobValue>(code, 3)(code), Gpu.Slot<Gpu.BlobValue>(code, 4)(code), IntPtr.Zero, out shader), "Creating the fade shader");
            return shader;
        } finally { Marshal.Release(code); }
    }

    public void Begin() {
        setTargets(Context, 1, new [] { target }, IntPtr.Zero);
        clear(Context, target, new [] { 0f, 0f, 0f, 1f });
        setInputLayout(Context, IntPtr.Zero);
        setTopology(Context, 4);
        setVertexShader(Context, vertexShader, IntPtr.Zero, 0);
        setPixelShader(Context, pixelShader, IntPtr.Zero, 0);
        setSamplers(Context, 0, 1, new [] { sampler });
        setConstants(Context, 0, 1, new [] { constants });
        setBlend(Context, blend, null, 0xFFFFFFFF);
    }

    public void DrawLayer(MonitorCapture layer, float opacity) {
        if (!layer.HasFrame || opacity <= 0) return;
        float scale = Math.Min((float)width / layer.Width, (float)height / layer.Height);
        Viewport viewport = new Viewport { Width = layer.Width * scale, Height = layer.Height * scale, MaxDepth = 1 };
        viewport.X = (width - viewport.Width) / 2;
        viewport.Y = (height - viewport.Height) / 2;
        update(Context, constants, 0, IntPtr.Zero, new [] { Math.Min(opacity, 1f), 0f, 0f, 0f }, 0, 0);
        setViewports(Context, 1, ref viewport);
        setShaderResources(Context, 0, 1, new [] { layer.View });
        draw(Context, 3, 0);
        setShaderResources(Context, 0, 1, new [] { IntPtr.Zero });
    }

    public void End() {
        present(swapChain, 0, 0);
    }

    public void Dispose() {
        Gpu.Release(ref blend);
        Gpu.Release(ref sampler);
        Gpu.Release(ref constants);
        Gpu.Release(ref pixelShader);
        Gpu.Release(ref vertexShader);
        Gpu.Release(ref target);
        Gpu.Release(ref swapChain);
        Gpu.Release(ref Context);
        Gpu.Release(ref Device);
    }
}

public sealed class MonitorCapture : IDisposable {
    public readonly IntPtr Monitor;
    public IntPtr Texture, View;
    public int Width, Height;
    public bool HasFrame;
    readonly Renderer renderer;
    readonly Direct3D11CaptureFramePool pool;
    readonly GraphicsCaptureSession session;
    SizeInt32 poolSize;

    public MonitorCapture(Renderer renderer, IntPtr monitor, int frameRate) {
        this.renderer = renderer;
        Monitor = monitor;
        IntPtr name;
        Gpu.Check(Gpu.WindowsCreateString("Windows.Graphics.Capture.GraphicsCaptureItem", 44, out name), "Naming the capture item");
        IntPtr factory, pointer;
        try {
            Guid interopId = new Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356");
            Gpu.Check(Gpu.RoGetActivationFactory(name, ref interopId, out factory), "Opening Windows Graphics Capture");
        } finally { Gpu.WindowsDeleteString(name); }
        try {
            Guid itemId = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760");
            Gpu.Check(Gpu.Slot<Gpu.CreateForMonitor>(factory, 4)(factory, monitor, ref itemId, out pointer), "Selecting the monitor");
        } finally { Marshal.Release(factory); }
        GraphicsCaptureItem item;
        try { item = (GraphicsCaptureItem)Marshal.GetObjectForIUnknown(pointer); }
        finally { Marshal.Release(pointer); }
        poolSize = item.Size;
        pool = Direct3D11CaptureFramePool.CreateFreeThreaded(renderer.CaptureDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, poolSize);
        session = pool.CreateCaptureSession(item);
        try { session.IsBorderRequired = false; } catch { }
        try { session.IsCursorCaptureEnabled = true; } catch { }
        try { session.MinUpdateInterval = TimeSpan.FromMilliseconds(Math.Max(1, 500 / Math.Max(1, frameRate))); } catch { }
        session.StartCapture();
    }

    public void Update() {
        Direct3D11CaptureFrame latest = null;
        while (true) {
            Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
            if (frame == null) break;
            if (latest != null) latest.Dispose();
            latest = frame;
        }
        if (latest == null) return;
        using (latest) {
            SizeInt32 size = latest.ContentSize;
            if (size.Width != poolSize.Width || size.Height != poolSize.Height) {
                poolSize = size;
                pool.Recreate(renderer.CaptureDevice, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            }
            IntPtr surface = Marshal.GetIUnknownForObject(latest.Surface);
            IntPtr access = IntPtr.Zero, frameTexture = IntPtr.Zero;
            try {
                Guid accessId = new Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1");
                Gpu.Check(Marshal.QueryInterface(surface, ref accessId, out access), "Reading the captured frame");
                Guid textureId = Gpu.Texture2DId;
                Gpu.Check(Gpu.Slot<Gpu.GetInterface>(access, 3)(access, ref textureId, out frameTexture), "Reading the captured texture");
                TextureDesc frameDesc;
                Gpu.Slot<Gpu.GetTextureDesc>(frameTexture, 10)(frameTexture, out frameDesc);
                int width = (int)Math.Min(frameDesc.Width, (uint)Math.Max(1, size.Width));
                int height = (int)Math.Min(frameDesc.Height, (uint)Math.Max(1, size.Height));
                if (width != Width || height != Height || Texture == IntPtr.Zero) Allocate(width, height);
                Box box = new Box { Right = (uint)width, Bottom = (uint)height, Back = 1 };
                renderer.CopyRegion(renderer.Context, Texture, 0, 0, 0, 0, frameTexture, 0, ref box);
                renderer.GenerateMips(renderer.Context, View);
                HasFrame = true;
            } finally {
                Gpu.Release(ref frameTexture);
                Gpu.Release(ref access);
                Marshal.Release(surface);
            }
        }
    }

    void Allocate(int width, int height) {
        Gpu.Release(ref View);
        Gpu.Release(ref Texture);
        Width = width;
        Height = height;
        TextureDesc desc = new TextureDesc { Width = (uint)width, Height = (uint)height, ArraySize = 1, Format = 87, SampleCount = 1, BindFlags = 0x28, Misc = 1 };
        Gpu.Check(Gpu.Slot<Gpu.CreateTexture2D>(renderer.Device, 5)(renderer.Device, ref desc, IntPtr.Zero, out Texture), "Creating the monitor texture");
        Gpu.Check(Gpu.Slot<Gpu.CreateView>(renderer.Device, 7)(renderer.Device, Texture, IntPtr.Zero, out View), "Creating the monitor view");
    }

    public void Dispose() {
        try { session.Dispose(); } catch { }
        try { pool.Dispose(); } catch { }
        Gpu.Release(ref View);
        Gpu.Release(ref Texture);
    }
}

public sealed class CaptureWindow : Form {
    static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();
    static readonly object OutputLock = new object();
    readonly CaptureCommand configuration;
    readonly ConcurrentQueue<CaptureCommand> commands = new ConcurrentQueue<CaptureCommand>();
    volatile bool running = true;

    public CaptureWindow(CaptureCommand configuration) {
        this.configuration = configuration;
        Text = "ScreenSharePlus Capture";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(configuration.width, configuration.height);
        Location = new Point(SystemInformation.VirtualScreen.Left - configuration.width * 2, SystemInformation.VirtualScreen.Top - configuration.height * 2);
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams {
        get {
            CreateParams parameters = base.CreateParams;
            parameters.ExStyle |= 0x80 | 0x08000000;
            return parameters;
        }
    }

    public static void Emit(object message) {
        lock (OutputLock) {
            Console.WriteLine("ScreenSharePlus:" + Serializer.Serialize(message));
            Console.Out.Flush();
        }
    }

    static IntPtr MonitorFor(CaptureRegion region) {
        Rect rect = new Rect { Left = region.x, Top = region.y, Right = region.x + region.width, Bottom = region.y + region.height };
        return Gpu.MonitorFromRect(ref rect, 0);
    }

    protected override void OnShown(EventArgs args) {
        base.OnShown(args);
        IntPtr handle = Handle;
        new Thread(() => Render(handle)) { IsBackground = true, Priority = ThreadPriority.AboveNormal }.Start();
        new Thread(ReadCommands) { IsBackground = true }.Start();
    }

    void ReadCommands() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            try { commands.Enqueue(Serializer.Deserialize<CaptureCommand>(line)); }
            catch { Emit(new { type = "error", sequence = 0 }); }
        }
        running = false;
    }

    void Render(IntPtr handle) {
        Renderer renderer = null;
        MonitorCapture current = null, pending = null, previous = null;
        int pendingSequence = 0;
        long pendingSince = 0, fadeStart = 0;
        bool ready = false;
        Stopwatch clock = Stopwatch.StartNew();
        double interval = 1000.0 / Math.Max(1, Math.Min(240, configuration.fps));
        double fade = Math.Max(0, Math.Min(2000, configuration.fade));
        double next = 0;
        try {
            renderer = new Renderer(handle, configuration.width, configuration.height);
            current = new MonitorCapture(renderer, MonitorFor(configuration.monitor), configuration.fps);
            while (running) {
                CaptureCommand command;
                while (commands.TryDequeue(out command)) {
                    IntPtr monitor;
                    try { monitor = MonitorFor(command.monitor); }
                    catch { Emit(new { type = "error", sequence = command.sequence }); continue; }
                    if (pending != null) {
                        Emit(new { type = "updated", sequence = pendingSequence });
                        pending.Dispose();
                        pending = null;
                    }
                    if (monitor == current.Monitor) { Emit(new { type = "updated", sequence = command.sequence }); continue; }
                    if (previous != null) { previous.Dispose(); previous = null; }
                    try {
                        pending = new MonitorCapture(renderer, monitor, configuration.fps);
                        pendingSequence = command.sequence;
                        pendingSince = clock.ElapsedMilliseconds;
                    } catch { Emit(new { type = "error", sequence = command.sequence }); }
                }

                current.Update();
                if (previous != null) previous.Update();
                if (pending != null) {
                    pending.Update();
                    if (pending.HasFrame) {
                        if (previous != null) previous.Dispose();
                        previous = current;
                        current = pending;
                        pending = null;
                        fadeStart = clock.ElapsedMilliseconds;
                        Emit(new { type = "updated", sequence = pendingSequence });
                    } else if (clock.ElapsedMilliseconds - pendingSince > 2000) {
                        pending.Dispose();
                        pending = null;
                        Emit(new { type = "error", sequence = pendingSequence });
                    }
                }

                float progress = previous == null || fade <= 0 ? 1 : (float)((clock.ElapsedMilliseconds - fadeStart) / fade);
                if (previous != null && progress >= 1) { previous.Dispose(); previous = null; }
                renderer.Begin();
                if (previous != null) renderer.DrawLayer(previous, 1 - progress);
                renderer.DrawLayer(current, progress);
                renderer.End();

                if (!ready && current.HasFrame) {
                    ready = true;
                    Emit(new { type = "ready", sourceId = "window:" + handle.ToInt64() + ":0" });
                } else if (!ready && clock.ElapsedMilliseconds > 8000) {
                    throw new InvalidOperationException("No frames were captured.");
                }

                next += interval;
                double now = clock.Elapsed.TotalMilliseconds;
                if (next < now - interval) next = now;
                while ((now = clock.Elapsed.TotalMilliseconds) < next) {
                    if (next - now > 1.5) Thread.Sleep(1);
                    else Thread.SpinWait(50);
                }
            }
        } catch (Exception error) {
            Emit(new { type = "error", sequence = 0, message = error.Message });
        } finally {
            if (pending != null) pending.Dispose();
            if (previous != null) previous.Dispose();
            if (current != null) current.Dispose();
            if (renderer != null) renderer.Dispose();
            try { BeginInvoke(new Action(Close)); } catch { }
        }
    }

    [STAThread] public static void Main(string[] args) {
        Gpu.SetProcessDpiAwarenessContext(new IntPtr(-4));
        Gpu.timeBeginPeriod(1);
        try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.AboveNormal; } catch { }
        CaptureCommand configuration = Serializer.Deserialize<CaptureCommand>(Encoding.UTF8.GetString(Convert.FromBase64String(args[0])));
        Application.Run(new CaptureWindow(configuration));
    }
}
`;
