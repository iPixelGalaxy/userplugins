/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { useAwaiter } from "@utils/react";
import type { PluginNative } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Alerts, MediaEngineStore, Menu, React, showToast, useEffect } from "@webpack/common";

import { isIgnoredMonitor, monitorKey } from "./monitors";
import type { Monitor } from "./native";
import type { CaptureMethod } from "./native/compositor";
import { rememberIgnoredMonitors, settings } from "./settings";

interface CaptureMenuProps extends React.ComponentProps<typeof Menu.Menu> {
    MenuComponent: typeof Menu.Menu;
}

const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;
const RetainIndicator = findComponentByCodeLazy("displayOnly:!0", 'usageVariant:"indicator"');
const KEYS = ["useObsCapture", "captureMethod", "ignoredMonitors", "bitrate", "keepPreview", "retainScreenshare", "retainScreenshareTimeout", "codec"] satisfies Array<keyof typeof settings.def>;
const CAPTURE_MODES = [{ label: "Discord capture", value: "discord" as const }, ...settings.def.captureMethod.options];
const CODEC_NOTES = {
    H264: "Broad compatibility and hardware encoding. Safest choice for Android and iOS viewers.",
    H265: "Higher compression than H264. Mobile viewing depends on the device and Discord client.",
    AV1: "High quality at lower bitrates with a supported encoder. Mobile viewing requires a compatible device and Discord client.",
    VP8: "Broad compatibility with software encoding. Suitable for Android and iOS viewers.",
    VP9: "Higher compression than VP8, with more encoding work. Mobile viewing depends on the device and Discord client."
};

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

export const CaptureMenu = ErrorBoundary.wrap(function CaptureMenu({ MenuComponent, children, ...props }: CaptureMenuProps) {
    const { useObsCapture, captureMethod, ignoredMonitors, bitrate, keepPreview, retainScreenshare, retainScreenshareTimeout, codec } = settings.use(KEYS);
    const [result, error, pending] = useAwaiter(() => Native.getMonitors());
    const [encoders, codecError, codecsPending] = useAwaiter(() => new Promise<string>(resolve => {
        MediaEngineStore.getMediaEngine().getCodecCapabilities(resolve);
    }).then(capabilities => {
        const available: { codec: string; encode: boolean; }[] = JSON.parse(capabilities);
        return available.filter(codec => codec.encode).map(codec => codec.codec);
    }));
    useEffect(() => () => { void Native.stopIdentification(); }, []);
    const monitors = !pending && !error && result?.success ? result.monitors : [];
    const allowed = monitors.filter((monitor: Monitor) => !isIgnoredMonitor(monitor, ignoredMonitors, monitors)).length;

    return <MenuComponent {...props}>
        <Menu.MenuGroup key="vc-screenshare-plus-controls">
            <Menu.MenuItem
                id="vc-screenshare-plus-retain"
                label="Retain Screenshare"
                subtext={`Rejoin within ${retainScreenshareTimeout} ${retainScreenshareTimeout === 1 ? "minute" : "minutes"} to resume in the same server. Stop Sharing clears the saved source.`}
                icon={RetainIndicator}
                iconProps={{ checked: retainScreenshare }}
                trailingIndicator={{ type: "icon", icon: RetainIndicator, checked: retainScreenshare }}
                dontCloseOnAction
                action={() => { settings.store.retainScreenshare = !settings.store.retainScreenshare; }}
            >
                <Menu.MenuControlItem
                    id="vc-screenshare-plus-retain-timeout"
                    label={`Rejoin timeout: ${retainScreenshareTimeout} ${retainScreenshareTimeout === 1 ? "minute" : "minutes"}`}
                    control={(props, ref) => <Menu.MenuSliderControl {...props} ref={ref} minValue={1} maxValue={30} value={retainScreenshareTimeout}
                        renderValue={(value: number) => `${Math.round(value)} ${Math.round(value) === 1 ? "minute" : "minutes"}`}
                        onChange={(value: number) => { settings.store.retainScreenshareTimeout = Math.round(value); }} />}
                />
            </Menu.MenuItem>
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
            <Menu.MenuItem id="vc-screenshare-plus-codec" label={`Video codec: ${codec}`}
                subtext={codecsPending ? "Checking encoder support."
                    : codecError ? "Could not check encoder support. Reopen this menu to try again."
                        : "Restart sharing after changing this. All viewers must support the codec."}>
                {settings.def.codec.options.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-screenshare-plus-codec-${value}`}
                        group="vc-screenshare-plus-codec"
                        label={label}
                        subtext={`${CODEC_NOTES[value]}${encoders && !encoders.includes(value) ? " No encoder available on this PC." : ""}`}
                        checked={codec === value}
                        disabled={!encoders?.includes(value)}
                        action={() => { settings.store.codec = value; }}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuItem id="vc-screenshare-plus-ignored" label="Ignored monitors" subtext="Applies to Monitor under mouse.">
                {monitors.length === 0
                    ? <Menu.MenuItem id="vc-screenshare-plus-loading" label={pending ? "Loading monitors..." : "Could not load monitors."} disabled />
                    : monitors.map((monitor: Monitor) => (
                        <Menu.MenuCheckboxItem
                            key={monitor.id}
                            id={`vc-screenshare-plus-ignore-${monitor.id}`}
                            label={monitor.name}
                            subtext={allowed === 1 && !isIgnoredMonitor(monitor, ignoredMonitors, monitors) ? "Keep at least one monitor allowed." : "Hover to identify this monitor."}
                            checked={isIgnoredMonitor(monitor, ignoredMonitors, monitors)}
                            action={() => {
                                rememberIgnoredMonitors(monitors);
                                const current = settings.store.ignoredMonitors;
                                const key = monitorKey(monitor);
                                if (current.includes(key)) settings.store.ignoredMonitors = current.filter(id => id !== key);
                                else if (monitors.some(other => other.id !== monitor.id && !isIgnoredMonitor(other, current, monitors)))
                                    settings.store.ignoredMonitors = [...current, key];
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
        </Menu.MenuGroup>
        {children}
    </MenuComponent>;
}, { noop: true });
