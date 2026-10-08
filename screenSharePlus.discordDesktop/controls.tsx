/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { useAwaiter } from "@utils/react";
import type { PluginNative } from "@utils/types";
import { Menu, React, useEffect } from "@webpack/common";

import type { Monitor } from "./native";
import { settings } from "./settings";

interface CaptureMenuProps extends React.ComponentProps<typeof Menu.Menu> {
    MenuComponent: typeof Menu.Menu;
}

const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;
const KEYS = ["captureApi", "fadeTransitions", "ignoredMonitors", "bitrate", "lockBitrate", "limitFrameRate", "degradation", "keepPreview"] satisfies Array<keyof typeof settings.def>;

export const CaptureMenu = ErrorBoundary.wrap(function CaptureMenu({ MenuComponent, children, ...props }: CaptureMenuProps) {
    const { captureApi, fadeTransitions, ignoredMonitors, bitrate, lockBitrate, limitFrameRate, degradation, keepPreview } = settings.use(KEYS);
    const [result, error, pending] = useAwaiter(() => Native.getMonitors());
    useEffect(() => () => { void Native.stopIdentification(); }, []);
    const monitors = !pending && !error && result?.success ? result.monitors : [];
    const allowed = monitors.filter((monitor: Monitor) => !ignoredMonitors.includes(monitor.id)).length;

    return <MenuComponent {...props}>
        <Menu.MenuGroup key="vc-screenshare-plus-controls">
            <Menu.MenuItem id="vc-screenshare-plus-capture" label="Capture API" subtext="Applies immediately.">
                {settings.def.captureApi.options.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-screenshare-plus-capture-${value}`}
                        group="vc-screenshare-plus-capture"
                        label={label}
                        subtext={value === "wgc" ? "Discord default. Captures displays and windows."
                            : "Captures displays directly. Windows use Discord's older capture. Monitor fades always use WGC."}
                        checked={captureApi === value}
                        action={() => { settings.store.captureApi = value; }}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuCheckboxItem
                id="vc-screenshare-plus-frame-rate"
                label="Limit to 30 FPS"
                subtext="More detail during movement."
                checked={limitFrameRate}
                action={() => { settings.store.limitFrameRate = !limitFrameRate; }}
            />
            <Menu.MenuItem id="vc-screenshare-plus-degradation" label="When bandwidth is low" subtext="What WebRTC gives up first.">
                {settings.def.degradation.options.map(({ label, value }) => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-screenshare-plus-degradation-${value}`}
                        group="vc-screenshare-plus-degradation"
                        label={label}
                        subtext={value === "disabled" ? "Keeps resolution and frame rate. Fast motion briefly looks softer."
                            : value === "balanced" ? "Lowers frame rate and resolution together."
                                : value === "framerate" ? "Discord default. Lowers resolution to keep motion smooth."
                                    : "Lowers frame rate to keep text sharp."}
                        checked={degradation === value}
                        action={() => { settings.store.degradation = value; }}
                    />
                ))}
            </Menu.MenuItem>
            <Menu.MenuCheckboxItem
                id="vc-screenshare-plus-fade"
                label="Fade between monitors"
                subtext="Applies to Monitor under mouse. Viewers see the fade; nothing appears on your screen."
                checked={fadeTransitions}
                action={() => { settings.store.fadeTransitions = !fadeTransitions; }}
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
                control={(props, ref) => <Menu.MenuSliderControl {...props} ref={ref} minValue={0} maxValue={50} value={bitrate}
                    renderValue={(value: number) => value < 1 ? "Automatic" : `${Math.round(value)} Mbps`}
                    onChange={(value: number) => { settings.store.bitrate = Math.round(value); }} />}
            />
            <Menu.MenuCheckboxItem
                id="vc-screenshare-plus-lock-bitrate"
                label="Lock bitrate"
                subtext="Always sends the full bitrate so motion never starts blurry. Needs upload above the bitrate you pick."
                checked={lockBitrate}
                action={() => { settings.store.lockBitrate = !lockBitrate; }}
            />
            <Menu.MenuCheckboxItem id="vc-screenshare-plus-preview" label="Keep stream preview playing" checked={keepPreview}
                action={() => { settings.store.keepPreview = !keepPreview; }} />
        </Menu.MenuGroup>
        {children}
    </MenuComponent>;
}, { noop: true });
