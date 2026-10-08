/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import type { MediaEngineConnection } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ApplicationStreamingSettingsStore, ApplicationStreamingStore, FluxDispatcher, MediaEngineStore, React, showToast, UserStore, VoiceActions } from "@webpack/common";

import { CaptureMenu } from "./controls";
import { settings } from "./settings";

interface StreamBitrate {
    bitrateMin: number;
    bitrateMax: number;
    bitrateTarget?: number;
    capture: { framerate: number; };
    encode: { framerate: number; };
}

interface MonitorMenuProps {
    id?: string;
    menuItemProps: {
        onMouseEnter?(event: React.MouseEvent): void;
        onMouseLeave?(event: React.MouseEvent): void;
    };
}

interface CaptureSource {
    id: string;
    name: string;
    url: string;
}

interface SourceEvent {
    settings: { context?: string; desktopSettings?: { sourceId: string; }; qualityOptions?: unknown; } | null;
}

interface StreamStartEvent {
    type: "STREAM_START";
    sourceId?: string;
    sourceName?: string;
    [key: string]: unknown;
}

interface CaptureConnection {
    context: string;
    goLiveSourceIdentifier: string | null;
    soundshareId: number | null;
    vcScreenSharePlusGraphics?: boolean;
    vcScreenSharePlusCaptureDevice?: boolean;
}

interface DesktopSource {
    id: string;
    soundshareId: number | null;
}

interface CaptureDescription {
    desktopDescription?: { id: string; soundshareId: number | null; useGraphicsCapture?: boolean; useCaptureDeviceForEncode?: boolean; };
}

interface PreviewProps {
    streamId: string;
    paused?: boolean;
    onReady?(): void;
}

const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;
const logger = new Logger("ScreenSharePlus");
const SOURCE_ID = "screen:vc-screenshare-plus";
const SOURCE_NAME = "Monitor under mouse";
const SoundshareStore: { getPidFromDesktopSource(id: string): number | null; } = findByPropsLazy("getPidFromDesktopSource");
const VideoStreamStore: { getStreamId(userId: string, guildId: string | null, context: string): string | undefined; } = findStoreLazy("VideoStreamStore");

let following = false;
let generation = 0;
let displayId: string | undefined;
let sourceId: string | undefined;
let intervalId: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let updating = false;
let videoSwitchSourceId: string | undefined;
let compositorSourceId: string | undefined;
let compositorKey: string | undefined;
let audioSourceId: string | undefined;
let syncing = false;
let syncQueued = false;
let syncTimeout: ReturnType<typeof setTimeout> | undefined;
let previewRecovery = false;

function stopFollowing() {
    following = false;
    generation++;
    displayId = undefined;
    sourceId = undefined;
    videoSwitchSourceId = undefined;
    compositorSourceId = undefined;
    compositorKey = undefined;
    audioSourceId = undefined;
    syncQueued = false;
    previewRecovery = false;
    void Native.stopCompositor().catch((error: unknown) => logger.warn("Could not close the monitor fade helper.", error));
    for (const timer of [syncTimeout, startTimeout]) if (timer !== undefined) clearTimeout(timer);
    syncTimeout = startTimeout = undefined;
    if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
    }
}

function stopCapture(message: string) {
    stopFollowing();
    VoiceActions.setGoLiveSource({ context: "stream" });
    showToast(message);
}

function switchSource(id: string) {
    const live = MediaEngineStore.getGoLiveSource();
    if (live == null) return;
    sourceId = id;
    videoSwitchSourceId = id;
    const { preset, soundshareEnabled } = ApplicationStreamingSettingsStore.getState();
    VoiceActions.setGoLiveSource({
        context: "stream",
        desktopSettings: { sourceId: id, sound: soundshareEnabled },
        qualityOptions: { preset, ...live.quality }
    });
}

// Sends the current source to Discord again. The connection patch treats a capture API change as a new source.
function recapture() {
    const current = MediaEngineStore.getGoLiveSource()?.desktopSource?.id;
    if (current == null) return;
    switchSource(sourceId !== undefined && current.split(":")[1] === sourceId.split(":")[1] ? sourceId : current);
}

function compositorQuality() {
    const live = MediaEngineStore.getGoLiveSource()?.quality;
    const state = ApplicationStreamingSettingsStore.getState();
    const frameRate = Math.min(live?.frameRate || state.fps, settings.store.limitFrameRate ? 30 : 240);
    const resolution = live?.resolution ?? state.resolution;
    return { frameRate, resolution, key: `${frameRate}:${resolution}` };
}

function scheduleSync() {
    if (!following) return;
    if (syncTimeout !== undefined) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        syncTimeout = undefined;
        void syncCapture();
    }, 250);
}

async function syncCapture(force = false) {
    if (syncing) {
        syncQueued = true;
        return;
    }
    if (!following || displayId === undefined || MediaEngineStore.getGoLiveSource()?.desktopSource == null) return;
    const quality = compositorQuality();
    if (!force && (compositorSourceId === undefined || settings.plain.fadeTransitions && compositorKey === quality.key)) return;

    syncing = true;
    const currentGeneration = ++generation;
    try {
        const { ignoredMonitors } = settings.plain;
        const screen = await Native.getCursorSource(undefined, ignoredMonitors);
        if (currentGeneration !== generation || !following) return;
        if (ignoredMonitors !== settings.plain.ignoredMonitors) {
            syncQueued = true;
            return;
        }
        if (!screen.success) {
            stopCapture(`ScreenSharePlus stopped sharing. ${screen.error}`);
            return;
        }
        if (screen.sourceId === null) return;
        displayId = screen.displayId;
        compositorSourceId = compositorKey = audioSourceId = undefined;
        switchSource(screen.sourceId);
        void Native.stopCompositor(true);
    } catch (error) {
        if (currentGeneration === generation) logger.error("Could not update monitor fades.", error);
    } finally {
        syncing = false;
        if (syncQueued) {
            syncQueued = false;
            void syncCapture(true);
        }
    }
}

async function followCursor() {
    if (updating || syncing) return;
    updating = true;
    const currentGeneration = generation;

    try {
        const { ignoredMonitors } = settings.plain;
        const result = await Native.getCursorSource(displayId, ignoredMonitors);
        if (currentGeneration !== generation || !following) return;
        if (ignoredMonitors !== settings.plain.ignoredMonitors) return;
        if (!result.success) {
            stopCapture(`ScreenSharePlus stopped sharing. ${result.error}`);
            return;
        }
        if (result.sourceId === null) return;
        if (MediaEngineStore.getGoLiveSource()?.desktopSource == null) {
            stopFollowing();
            return;
        }

        if (settings.plain.fadeTransitions && displayId !== undefined) {
            const quality = compositorQuality();
            const prepared = await Native.prepareCompositor(displayId, ignoredMonitors, quality.frameRate, quality.resolution);
            if (currentGeneration !== generation || !following) {
                if (prepared.success) void Native.stopCompositor();
                return;
            }
            if (prepared.success && settings.plain.fadeTransitions) {
                compositorSourceId = prepared.sourceId;
                compositorKey = quality.key;
                audioSourceId = result.sourceId;
                switchSource(prepared.sourceId);
                const moved = await Native.setCompositorMonitor(result.displayId, ignoredMonitors);
                if (currentGeneration !== generation || !following) return;
                if (!moved.success) logger.warn(moved.error);
            } else {
                if (!prepared.success) logger.warn(prepared.error);
                else void Native.stopCompositor();
            }
        }

        displayId = result.displayId;
        const faded = compositorSourceId !== undefined;
        compositorSourceId = compositorKey = audioSourceId = undefined;
        if (MediaEngineStore.getGoLiveSource()?.desktopSource?.id === result.sourceId) {
            sourceId = result.sourceId;
        } else switchSource(result.sourceId);
        if (faded) void Native.stopCompositor(true);
    } catch (error) {
        if (currentGeneration !== generation) return;
        logger.error("Could not switch the shared monitor.", error);
        stopCapture("ScreenSharePlus stopped sharing because it could not switch monitors.");
    } finally {
        updating = false;
    }
}

export default definePlugin({
    name: "ScreenSharePlus",
    description: "Adds capture controls and a screen share option that follows your mouse between monitors.",
    authors: [EquicordDevs.nobody],
    tags: ["Media", "Voice"],
    settings,

    patches: [
        {
            find: '"MenuCheckboxItem"',
            replacement: {
                match: /function \i\((\i)\)\{(?=.{0,450}?"MenuCheckboxItem")/,
                replace: "$&$1=$self.monitorHoverProps(arguments[0]);"
            }
        },
        {
            find: 'navId:"manage-streams"',
            replacement: {
                match: /(\i\.\i),\{(?=[^{}]{0,250}?navId:"manage-streams")/,
                replace: "$self.CaptureMenu,{MenuComponent:$1,"
            }
        },
        {
            find: 'navId:"stream-options"',
            replacement: {
                match: /(\i\.\i),\{(?=[^{}]{0,250}?navId:"stream-options")/,
                replace: "$self.CaptureMenu,{MenuComponent:$1,"
            }
        },
        {
            find: "this.getDefaultGoliveQuality()",
            replacement: {
                match: /(?<=applyQualityConstraints\(\i,\i\)\{let \i=)this\.getQuality\(\i\)/,
                replace: "$self.overrideBitrate($&,this.isStreamContext,this.goliveMaxQuality)"
            }
        },
        {
            find: "}setDesktopEncodingOptions(",
            replacement: {
                match: /null==(\i)&&\(\i=.{0,100}?\);(?=let \i=\{width:)/,
                replace: "$&$1=$self.maximumBitrate($1);"
            }
        },
        {
            find: "desktopDegradationPreference=",
            replacement: {
                match: /desktopDegradationPreference=(\(0,\i\.\i\)\(\)\.DegradationPreference)\.MAINTAIN_FRAMERATE;/,
                replace: "vcScreenSharePlusDegradation=$1;get desktopDegradationPreference(){return $self.degradationPreference(this.vcScreenSharePlusDegradation)}"
            }
        },
        {
            find: '"MediaEngineStore go live"',
            replacement: [
                {
                    match: /(?<=\.videoHook,\i=)\i\(\)(?=,)/,
                    replace: "$self.useGraphicsCapture($&)"
                },
                {
                    match: /(?<=useCaptureDeviceForEncode:)\(0,\i\.\i\)\(\)/,
                    replace: "$self.useCaptureDeviceForEncode($&)"
                },
                {
                    // Discord stops soundshare and clears the stream before every source change, which cuts audio.
                    match: /(\i)\?\.desktopSource!=null&&\1\.desktopSource\.id!==(\i)\?\.desktopSource\?\.id&&/,
                    replace: "$&!$self.keepSource($1.desktopSource,$2?.desktopSource)&&"
                }
            ]
        },
        {
            find: '"2026-09-single-cpu-copy"',
            replacement: {
                match: /(\i)(?=&&\(\i\+=",singleCpuCopy"\))/,
                replace: "($1=$self.allowSingleCpuCopy($1,this.context,this.getVoiceParticipantType()))"
            }
        },
        {
            find: '"DirectVideo"',
            replacement: {
                match: /function \i\((\i)\)\{(?=return function\(\i,\i\)\{let\{streamId:)/,
                replace: "$&$1=$self.usePreviewRecovery($1);"
            }
        },
        {
            find: "streamerPaused()",
            replacement: {
                match: /streamerPaused\(\)\{/,
                replace: "$&if($self.keepPreview())return false;"
            }
        },
        {
            find: "StreamTile",
            replacement: {
                match: /\i\.\i\.isFocused\(\)/,
                replace: "($self.keepPreview()||$&)"
            }
        },
        {
            find: "Can't get desktop sources outside of native app",
            replacement: {
                match: /Promise\.all\(\i\)\.then\(\i=>\i\(\)\(\i\)\)/,
                replace: "$self.addSources($&)"
            }
        },
        {
            find: '"startStreamWithSource"',
            replacement: {
                match: /async function \i\((\i),\i\)\{/,
                replace: "$&$1=await $self.prepareSource(arguments[0]);"
            }
        },
        {
            find: 'type:"STREAM_START"',
            replacement: {
                match: /\i\.\i\.dispatch(?=\(\{type:"STREAM_START")/,
                replace: "$self.startStream"
            }
        },
        {
            find: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE:function",
            replacement: {
                match: /\i\.\i\.getPidFromDesktopSource\((\i)\)/g,
                replace: "$self.getSourcePid($1,$&)"
            }
        },
        {
            find: "this.goLiveSourceIdentifier===",
            group: true,
            replacement: [
                {
                    match: /setGoLiveSource\(\i\)\{/,
                    replace: "$&const vcScreenSharePlusKeepAudio=$self.shouldKeepAudio(this,arguments[0]);"
                },
                {
                    match: /this\.goLiveSourceIdentifier===(\i)(?=\)\{if\(this\.setDesktopEncodingOptions)/,
                    replace: "$self.sameCapture(this,arguments[0],$1)"
                },
                {
                    match: /this\.setSoundshareSource\(\i,\i\)(?=;let\[\i,\i\])/,
                    replace: "vcScreenSharePlusKeepAudio||$&"
                }
            ]
        }
    ],

    start() {
        void Native.removeLegacyCapture();
        if (settings.store.fadeTransitions) void Native.warmCompositor();
    },

    stop: stopFollowing,

    CaptureMenu,

    monitorHoverProps<T extends MonitorMenuProps>(props: T): T {
        const prefix = "vc-screenshare-plus-ignore-";
        if (!props.id?.startsWith(prefix)) return props;
        const id = props.id.slice(prefix.length);
        return { ...props, menuItemProps: {
            ...props.menuItemProps,
            onMouseEnter(event: React.MouseEvent) {
                props.menuItemProps.onMouseEnter?.(event);
                void Native.identifyMonitor(id, true).then(result => {
                    if (!result.success) showToast(result.error);
                }).catch(() => showToast("Could not identify that monitor."));
            },
            onMouseLeave(event: React.MouseEvent) {
                props.menuItemProps.onMouseLeave?.(event);
                void Native.stopIdentification();
            }
        } };
    },

    keepPreview() {
        return settings.plain.keepPreview;
    },

    allowSingleCpuCopy(enabled: boolean, context: string, participantType: string) {
        return enabled && (context !== "stream" || participantType !== "streamer");
    },

    useGraphicsCapture(supported: boolean) {
        return supported && (compositorSourceId !== undefined || settings.plain.captureApi !== "dxgi");
    },

    useCaptureDeviceForEncode(supported: boolean) {
        return supported && !previewRecovery;
    },

    usePreviewRecovery<T extends PreviewProps>(props: T): T {
        const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
        const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
        const own = stream !== null && props.streamId === VideoStreamStore.getStreamId(UserStore.getCurrentUser().id, stream.guildId, "stream");
        React.useEffect(() => {
            if (!own || props.paused || previewRecovery || MediaEngineStore.getGoLiveSource()?.desktopSource == null) return;
            timer.current = setTimeout(() => {
                const current = ApplicationStreamingStore.getCurrentUserActiveStream();
                if (previewRecovery || current === null || MediaEngineStore.getGoLiveSource()?.desktopSource == null
                    || props.streamId !== VideoStreamStore.getStreamId(UserStore.getCurrentUser().id, current.guildId, "stream")) return;
                previewRecovery = true;
                logger.warn("Restarting capture because the local stream preview did not receive video.");
                recapture();
            }, 5000);
            return () => {
                if (timer.current !== undefined) clearTimeout(timer.current);
                timer.current = undefined;
            };
        }, [props.streamId, props.paused, own]);
        return { ...props, onReady() {
            if (timer.current !== undefined) clearTimeout(timer.current);
            timer.current = undefined;
            props.onReady?.();
        } };
    },

    getSourcePid(id: string, pid: number | null) {
        return id === compositorSourceId && audioSourceId !== undefined ? SoundshareStore.getPidFromDesktopSource(audioSourceId) : pid;
    },

    // Discord scales stream bitrate down to the viewer's player size and starts the encoder at 0.6 Mbps.
    // Use the full stream budget instead and start near it. Static screens send very little, so WebRTC's
    // bandwidth estimate collapses toward the minimum; the floor keeps room for sudden motion.
    overrideBitrate<T extends StreamBitrate>(quality: T, streaming: boolean, full: StreamBitrate = quality): T {
        if (!streaming) return quality;
        const { bitrate, lockBitrate, limitFrameRate } = settings.store;
        const maximum = bitrate * 1_000_000 || Math.max(quality.bitrateMax, full.bitrateMax);
        return { ...quality,
            bitrateMin: lockBitrate ? maximum : Math.min(maximum, Math.max(full.bitrateMin, Math.round(maximum / 4))),
            bitrateMax: maximum,
            bitrateTarget: bitrate === 0 && !lockBitrate ? Math.max(full.bitrateTarget ?? 0, Math.round(maximum / 2)) : maximum,
            capture: limitFrameRate ? { ...quality.capture, framerate: Math.min(quality.capture.framerate, 30) } : quality.capture,
            encode: limitFrameRate ? { ...quality.encode, framerate: Math.min(quality.encode.framerate, 30) } : quality.encode
        };
    },

    degradationPreference(preferences: Record<string, number>) {
        const { degradation } = settings.plain;
        const name = degradation === "disabled" ? "DISABLED" : degradation === "balanced" ? "BALANCED"
            : degradation === "resolution" ? "MAINTAIN_RESOLUTION" : "MAINTAIN_FRAMERATE";
        return preferences[name] ?? preferences.MAINTAIN_FRAMERATE;
    },

    maximumBitrate(original: number) {
        return settings.plain.bitrate * 1_000_000 || original;
    },

    updateBitrate() {
        MediaEngineStore.getMediaEngine().eachConnection((connection: MediaEngineConnection) => {
            if (connection.context !== "stream" || !connection.hasDesktopSource() || connection.videoStreamParameters.length === 0) return;
            connection.updateVideoQuality();
            connection.applyVideoTransportOptions();
        });
    },

    flux: {
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE({ settings }: SourceEvent) {
            if (!following) return;
            if (settings?.qualityOptions != null) scheduleSync();
            const id = settings?.desktopSettings?.sourceId;
            if (settings?.context !== "stream" || id === undefined || id.split(":")[0] !== sourceId?.split(":")[0]
                || id.split(":")[1] !== sourceId?.split(":")[1]) {
                stopFollowing();
                return;
            }
            if (intervalId === undefined)
                intervalId = setInterval(followCursor, 50);
            if (startTimeout !== undefined) {
                clearTimeout(startTimeout);
                startTimeout = undefined;
            }
        },
        STREAM_STOP({ streamKey }: { streamKey: string; }) {
            if (streamKey.endsWith(UserStore.getCurrentUser().id)) stopFollowing();
        },
        STREAM_DELETE({ streamKey }: { streamKey: string; }) {
            if (streamKey.endsWith(UserStore.getCurrentUser().id)) stopFollowing();
        },
        LOGOUT: stopFollowing
    },

    onCaptureApiChange: recapture,

    onFadeChange() {
        if (settings.store.fadeTransitions) void Native.warmCompositor();
        scheduleSync();
    },

    onFrameRateLimitChange: scheduleSync,

    onIgnoredMonitorsChange() {
        if (!following) return;
        void syncCapture(true);
    },

    startStream(event: StreamStartEvent) {
        if (event.sourceName === SOURCE_NAME && (!following || event.sourceId !== sourceId
            || displayId === undefined || settings.plain.ignoredMonitors.includes(displayId))) return;
        return FluxDispatcher.dispatch(event);
    },

    // Monitor switches and fade helper swaps keep the same system audio, so Discord's teardown only causes a gap.
    keepSource(previous: DesktopSource, next: DesktopSource | undefined) {
        return following && next != null && next.id === videoSwitchSourceId && previous.soundshareId === next.soundshareId;
    },

    sameCapture(connection: CaptureConnection, source: CaptureDescription, id: string | null) {
        const graphics = source.desktopDescription?.useGraphicsCapture;
        const captureDevice = source.desktopDescription?.useCaptureDeviceForEncode;
        if (connection.goLiveSourceIdentifier === id && connection.vcScreenSharePlusGraphics === graphics
            && connection.vcScreenSharePlusCaptureDevice === captureDevice) return true;
        connection.vcScreenSharePlusGraphics = graphics;
        connection.vcScreenSharePlusCaptureDevice = captureDevice;
        return false;
    },

    shouldKeepAudio(connection: CaptureConnection, source: CaptureDescription) {
        const description = source.desktopDescription;
        if (connection.context !== "stream" || connection.goLiveSourceIdentifier === null
            || description == null || description.soundshareId !== connection.soundshareId) return false;
        return description.id === connection.goLiveSourceIdentifier
            || following && connection.goLiveSourceIdentifier !== videoSwitchSourceId && description.id === videoSwitchSourceId;
    },

    async addSources(promise: Promise<CaptureSource[]>) {
        const sources = await promise;
        if (!sources.some((source: CaptureSource) => source.id.startsWith("screen"))) return sources;

        try {
            const result = await Native.getCursorSource(undefined, settings.plain.ignoredMonitors, true);
            if (!result.success || result.sourceId === null) return sources;
            return [{ id: SOURCE_ID, name: SOURCE_NAME, url: result.url }, ...sources];
        } catch (error) {
            logger.warn("Could not add the monitor under your mouse to the screen picker.", error);
        }

        return sources;
    },

    async prepareSource(source: CaptureSource | number | null) {
        stopFollowing();
        if (typeof source !== "object" || source === null) return source;
        sourceId = source.id;
        if (source.id !== SOURCE_ID) return source;
        const currentGeneration = generation;
        const { ignoredMonitors } = settings.plain;

        try {
            const result = await Native.getCursorSource(undefined, ignoredMonitors);
            if (currentGeneration !== generation) return null;
            if (ignoredMonitors !== settings.plain.ignoredMonitors) {
                stopCapture("Ignored monitors changed. Start screen sharing again.");
                return null;
            }
            if (!result.success) {
                stopCapture(`ScreenSharePlus could not start. ${result.error}`);
                return null;
            }
            if (result.sourceId === null) return null;

            following = true;
            displayId = result.displayId;
            sourceId = result.sourceId;
            startTimeout = setTimeout(() => {
                if (intervalId === undefined) stopFollowing();
            }, 30_000);
            return { ...source, id: sourceId, name: SOURCE_NAME };
        } catch (error) {
            if (currentGeneration !== generation) return null;
            logger.error("Could not read the monitor under your mouse.", error);
            showToast("ScreenSharePlus could not start. Fully restart Discord and try again.");
            return null;
        }
    }
});
