/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, Guild } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore } from "@webpack/common";

const settings = definePluginSettings({}).withPrivateSettings<{
    disabledChannelIds?: string[];
    disabledGuildIds?: string[];
}>();

function canDisableSameChannelNotifications(channel: Channel | undefined) {
    return channel != null && (channel.isGuildVocal()
        || (!channel.isCategory() && !channel.isDirectory() && !channel.isForumChannel() && !channel.isVocal()));
}

function isDisabled(channelId: string) {
    return settings.store.disabledChannelIds?.includes(channelId) ?? false;
}

function toggleChannel(channelId: string) {
    const channelIds = settings.store.disabledChannelIds ?? [];
    settings.store.disabledChannelIds = channelIds.includes(channelId)
        ? channelIds.filter(id => id !== channelId)
        : [...channelIds, channelId];
}

function isGuildDisabled(guildId: string) {
    return settings.store.disabledGuildIds?.includes(guildId) ?? false;
}

function toggleGuild(guildId: string) {
    const guildIds = settings.store.disabledGuildIds ?? [];
    settings.store.disabledGuildIds = guildIds.includes(guildId)
        ? guildIds.filter(id => id !== guildId)
        : [...guildIds, guildId];
}

export default definePlugin({
    name: "DisableSameChannelNotifications",
    description: "Mute same-channel message sounds in selected text and voice chats.",
    authors: [Devs.Ven],
    settings,

    patches: [
        {
            find: '"NotificationStore"',
            replacement: [
                {
                    match: /!\i\.\i\.isSoundDisabled\(\i\)(?=;if\(\i&&\(\i\(\i\),\i&&\i\.\i\.playNotificationSound\("message3",)/,
                    replace: "$&&&!$self.shouldSuppress(arguments[0].channelId)"
                },
                {
                    match: /&&(?=\i\.\i\.playNotificationSound\("message3",)/,
                    replace: "$&!$self.shouldSuppress(arguments[0].channelId,true)&&"
                }
            ]
        }
    ],

    contextMenus: {
        "channel-context"(children, { channel }: { channel?: Channel; }) {
            const channelId = channel?.id;
            if (!channelId || !canDisableSameChannelNotifications(channel)) return;

            const item = (
                <Menu.MenuCheckboxItem
                    id="vc-disable-same-channel-notifications"
                    label="No Same-Channel Ping"
                    checked={isDisabled(channelId)}
                    action={() => toggleChannel(channelId)}
                />
            );
            const autoTranslateIndex = children.findIndex(child => child?.props?.id === "vc-translate-plus-channel");
            if (autoTranslateIndex === -1) children.push(item);
            else children.splice(autoTranslateIndex + 1, 0, item);
        },
        "guild-context"(children, { guild }: { guild?: Guild; }) {
            if (!guild) return;
            children.push(
                <Menu.MenuCheckboxItem
                    id="vc-disable-same-channel-notifications-guild"
                    label="No Same-Channel Pings"
                    checked={isGuildDisabled(guild.id)}
                    action={() => toggleGuild(guild.id)}
                />
            );
        }
    },

    shouldSuppress(channelId: string, sameChannelSound = false) {
        const selected = SelectedChannelStore.getChannelId() === channelId;
        if (!selected && SelectedChannelStore.getVoiceChannelId() !== channelId) return false;

        const channel = ChannelStore.getChannel(channelId);
        if (!channel?.isGuildVocal() && !(selected && sameChannelSound)) return false;

        const guildId = channel?.guild_id;
        return isDisabled(channelId) || (guildId != null && isGuildDisabled(guildId));
    }
});
