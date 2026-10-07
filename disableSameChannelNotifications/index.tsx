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
    return channel != null && !channel.isCategory() && !channel.isDirectory() && !channel.isForumChannel() && !channel.isVocal();
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

function getChannelId(message: unknown, channel: unknown) {
    if (typeof channel === "string") return channel;
    if (typeof channel === "object" && channel !== null && "id" in channel && typeof channel.id === "string") return channel.id;
    if (typeof message === "object" && message !== null && "channel_id" in message && typeof message.channel_id === "string") return message.channel_id;
}

function getGuildId(message: unknown, channelId: string) {
    if (typeof message === "object" && message !== null && "guild_id" in message && typeof message.guild_id === "string") return message.guild_id;
    return ChannelStore.getChannel(channelId)?.guild_id;
}

export default definePlugin({
    name: "DisableSameChannelNotifications",
    description: "Disable native same-channel notifications in selected channels.",
    authors: [Devs.Ven],
    settings,

    patches: [
        {
            find: "NOTIFICATION_CREATE:function",
            replacement: {
                match: /(\i)&&(\i\.\i\.playNotificationSound\("message3",\.4\))/,
                replace: "$self.shouldSuppress(arguments[0]?.message,void 0)?void 0:$1&&$2"
            }
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

    shouldSuppress(message: unknown, channel: unknown) {
        const channelId = getChannelId(message, channel);
        return channelId != null
            && (isDisabled(channelId) || isGuildDisabled(getGuildId(message, channelId) ?? ""))
            && SelectedChannelStore.getChannelId() === channelId;
    }
});
