/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { useAwaiter } from "@utils/react";
import type { PluginNative } from "@utils/types";
import type { FluxStore } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Alerts, ApplicationStreamingStore, MediaEngineStore, Menu, React, showToast, useEffect, UserStore, useStateFromStores } from "@webpack/common";

import type { Monitor } from "./native";
import type { CaptureMethod } from "./native/compositor";
import { settings } from "./settings";

interface VideoProps {
    streamId: string;
    paused: boolean;
    className: string;
}

interface PreviewStore extends FluxStore {
    getStreamId(userId: string, guildId: string | null, context: "stream"): string | undefined;
}

interface CaptureMenuProps extends React.ComponentProps<typeof Menu.Menu> {
    MenuComponent: typeof Menu.Menu;
    live: boolean;
}

const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;
const KEYS = ["useObsCapture", "captureMethod", "ignoredMonitors", "bitrate", "limitFrameRate", "keepPreview"] satisfies Array<keyof typeof settings.def>;
const CAPTURE_MODES = [{ label: "Discord capture", value: "discord" as const }, ...settings.def.captureMethod.options];
const VideoStreamStore = findStoreLazy("VideoStreamStore") as PreviewStore;

async function changeCapture(method: CaptureMethod | "discord") {
    if (method === "discord") { settings.store.useObsCapture = false; return; }
    if (settings.store.obsCaptureAcknowledged) {
        settings.store.captureMethod = method;
        settings.store.useObsCapture = true;
        return;
    }
    const directory = await Native.getCaptureDirectory();
    Alerts.show({
        title: "Enable fade capture",
        body: <>
            <Paragraph>This downloads about 188 MB of OBS components and builds a background capture helper. The OBS app is not opened. Preparing multiple displays uses more GPU resources.</Paragraph>
            <Paragraph>To remove these components later, choose Discord capture, stop sharing, fully close Discord, then delete this folder:</Paragraph>
            <Paragraph>{directory}</Paragraph>
        </>,
        confirmText: "Enable capture",
        cancelText: "Cancel",
        onConfirm() {
            settings.store.obsCaptureAcknowledged = true;
            settings.store.captureMethod = method;
            settings.store.useObsCapture = true;
        }
    });
}

const LivePreview = ErrorBoundary.wrap(function LivePreview() {
    const streamId = useStateFromStores([VideoStreamStore, UserStore, ApplicationStreamingStore], () => {
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        return stream ? VideoStreamStore.getStreamId(UserStore.getCurrentUser().id, stream.guildId, "stream") : undefined;
    });
    if (!streamId) return <Paragraph>Waiting for your stream preview.</Paragraph>;
    const Video = MediaEngineStore.getMediaEngine().Video as React.ComponentType<VideoProps>;
    return <Video streamId={streamId} paused={false} className="vc-screenshare-plus-preview" />;
}, { noop: true });

export const CaptureMenu = ErrorBoundary.wrap(function CaptureMenu({ MenuComponent, live, children, ...props }: CaptureMenuProps) {
    const { useObsCapture, captureMethod, ignoredMonitors, bitrate, limitFrameRate, keepPreview } = settings.use(KEYS);
    const [result, error, pending] = useAwaiter(() => Native.getMonitors());
    useEffect(() => () => { void Native.stopIdentification(); }, []);
    const monitors = !pending && !error && result?.success ? result.monitors : [];
    const allowed = monitors.filter((monitor: Monitor) => !ignoredMonitors.includes(monitor.id)).length;

    return <MenuComponent {...props}>
        <Menu.MenuGroup key="vc-screenshare-plus-controls">
            <Menu.MenuItem id="vc-screenshare-plus-capture" label="Capture mode"
                subtext="Applies when starting a new share. Fade modes use OBS libraries.">
                {CAPTURE_MODES.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-screenshare-plus-capture-${value}`}
                        group="vc-screenshare-plus-capture"
                        label={label}
                        subtext={value === "discord" ? "Discord capture without monitor fades."
                            : value === "dxgi" ? "DXGI for displays and WGC for windows, with monitor fades."
                                : value === "obs" ? "OBS chooses the capture API, with monitor fades."
                                    : "Prefer WGC and fall back to DXGI for displays, with monitor fades."}
                        checked={useObsCapture ? value === captureMethod : value === "discord"}
                        action={() => { void changeCapture(value).catch(() => showToast("Could not change capture mode. Fully restart Discord and try again.")); }}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuCheckboxItem
                id="vc-screenshare-plus-frame-rate"
                label="Limit to 30 FPS"
                subtext="More detail during movement. Restart sharing after changing this."
                checked={limitFrameRate}
                action={() => { settings.store.limitFrameRate = !limitFrameRate; }}
            />
            <Menu.MenuItem id="vc-screenshare-plus-ignored" label="Ignored monitors" subtext="Applies to Monitor under mouse.">
                {monitors.length === 0
                    ? <Menu.MenuItem id="vc-screenshare-plus-loading" label={pending ? "Loading monitors..." : "Could not load monitors."} disabled />
                    : monitors.map((monitor: Monitor) => (
                        <Menu.MenuCheckboxItem
                            key={monitor.id}
                            id={`vc-screenshare-plus-ignore-${monitor.id}`}
                            label={monitor.name}
                            subtext={allowed === 1 && !ignoredMonitors.includes(monitor.id) ? "Keep at least one monitor allowed." : "Hover to identify this monitor."}
                            checked={ignoredMonitors.includes(monitor.id)}
                            action={() => {
                                if (allowed === 1 && !ignoredMonitors.includes(monitor.id)) return;
                                settings.store.ignoredMonitors = ignoredMonitors.includes(monitor.id)
                                    ? ignoredMonitors.filter((id: string) => id !== monitor.id)
                                    : [...ignoredMonitors, monitor.id];
                            }}
                        />
                    ))}
            </Menu.MenuItem>
            <Menu.MenuControlItem
                id="vc-screenshare-plus-bitrate"
                label={bitrate === 0 ? "Video bitrate: Automatic" : `Video bitrate: ${bitrate} Mbps`}
                control={(props, ref) => <Menu.MenuSliderControl {...props} ref={ref} minValue={0} maxValue={20} value={bitrate}
                    renderValue={(value: number) => value < 1 ? "Automatic" : `${Math.round(value)} Mbps`}
                    onChange={(value: number) => { settings.store.bitrate = Math.round(value); }} />}
            />
            <Menu.MenuCheckboxItem id="vc-screenshare-plus-preview" label="Keep stream preview playing" checked={keepPreview}
                action={() => { settings.store.keepPreview = !keepPreview; }} />
            {live && keepPreview ? <Menu.MenuControlItem id="vc-screenshare-plus-live-preview" interactive={false} control={() => <LivePreview />} /> : null}
        </Menu.MenuGroup>
        {children}
    </MenuComponent>;
}, { noop: true });
