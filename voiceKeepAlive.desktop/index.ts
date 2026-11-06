/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { FluxDispatcher, SelectedChannelStore, showToast } from "@webpack/common";

const Native = VencordNative.pluginHelpers.VoiceKeepAlive as PluginNative<typeof import("./native")>;
const logger = new Logger("VoiceKeepAlive");
let running = false;

const settings = definePluginSettings({
    preventSleep: {
        type: OptionType.BOOLEAN,
        description: "Prevent automatic system sleep during voice calls. The display can still turn off. This may increase battery use.",
        default: true,
        onChange: () => { if (running) void updateKeepAlive(); }
    }
});

async function updateKeepAlive(forceOff = false) {
    try {
        const result = await Native.setActive(!forceOff && running && !!SelectedChannelStore.getVoiceChannelId(), settings.store.preventSleep);
        if (!result.success) throw new Error(result.error);
    } catch (error) {
        logger.warn("Could not update voice keepalive.", error);
        showToast("VoiceKeepAlive could not update. Fully quit and reopen Discord after building.");
    }
}

function updateAfterDispatch() {
    FluxDispatcher.wait(() => { void updateKeepAlive(); });
}

export default definePlugin({
    name: "VoiceKeepAlive",
    description: "Experimental fix for background voice disconnects. Disables background throttling during voice calls and optionally prevents automatic sleep.",
    authors: [Devs.Ven],
    settings,

    start() {
        running = true;
        void updateKeepAlive();
    },

    stop() {
        running = false;
        void updateKeepAlive(true);
    },

    flux: {
        VOICE_CHANNEL_SELECT: updateAfterDispatch,
        VOICE_STATE_UPDATES: updateAfterDispatch,
        CONNECTION_OPEN: updateAfterDispatch,
        LOGOUT() {
            void updateKeepAlive(true);
        }
    }
});
