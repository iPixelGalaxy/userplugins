/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import type { Guild } from "@vencord/discord-types";
import { ContextMenuApi, GuildRoleStore, GuildStore, lodash, Menu, SearchableSelect, SelectedGuildStore, useState, useStateFromStores } from "@webpack/common";

const settings = definePluginSettings({}).withPrivateSettings<{
    hiddenGuildIds?: string[];
}>();

const SETTING_KEYS: ["hiddenGuildIds"] = ["hiddenGuildIds"];

function setGuildHidden(guildId: string, hidden: boolean) {
    const guildIds = (settings.store.hiddenGuildIds ?? []).filter(id => id !== guildId);
    settings.store.hiddenGuildIds = hidden ? [...guildIds, guildId] : guildIds;
}

function GuildSettings() {
    const { hiddenGuildIds = [] } = settings.use(SETTING_KEYS);
    const guilds = useStateFromStores([GuildStore], () => Object.values(GuildStore.getGuilds()).sort((a, b) => a.name.localeCompare(b.name)), [], lodash.isEqual);
    const [guildId, setGuildId] = useState(() => SelectedGuildStore.getGuildId() ?? guilds[0]?.id ?? "");

    return (
        <>
            <Paragraph>
                Choose a server to configure its role icons in chat and the member list.
                You can also right-click a server and toggle Hide Role Badges.
            </Paragraph>
            <SearchableSelect
                options={guilds.map(guild => ({ label: guild.name, value: guild.id }))}
                value={guildId}
                placeholder="Select a server"
                maxVisibleItems={6}
                closeOnSelect
                onChange={setGuildId}
            />
            <FormSwitch
                className={Margins.top16}
                title="Hide role badges in this server"
                description="Other servers keep their own settings."
                disabled={!guildId}
                value={hiddenGuildIds.includes(guildId)}
                onChange={hidden => setGuildHidden(guildId, hidden)}
            />
        </>
    );
}

export default definePlugin({
    name: "HideRoleBadges",
    description: "Hide role icons in chat and the member list for selected servers.",
    authors: [Devs.Ven],
    tags: ["Appearance", "Chat"],
    settings,

    settingsAboutComponent: GuildSettings,

    patches: [
        {
            find: ".customIconSrc,name:",
            replacement: {
                match: /(?<=return )\i\.useMemo\(\(\)=>\i\(\i(?:,\i)?\),\[\i(?:,\i)?\]\)/g,
                replace: "$self.useRoleIcon($&)"
            }
        }
    ],

    contextMenus: {
        "guild-context"(children, { guild }: { guild?: Guild; }) {
            if (!guild) return;

            const guildId = guild.id;
            const hidden = settings.store.hiddenGuildIds?.includes(guildId) ?? false;
            children.push(
                <Menu.MenuCheckboxItem
                    key={guildId}
                    id={`vc-hide-role-badges-${guildId}`}
                    label="Hide Role Badges"
                    checked={hidden}
                    action={() => {
                        setGuildHidden(guildId, !hidden);
                        ContextMenuApi.closeContextMenu();
                    }}
                />
            );
        }
    },

    useRoleIcon<T extends { roleId: string; }>(icon: T | undefined) {
        const { hiddenGuildIds = [] } = settings.use(SETTING_KEYS);
        return icon && hiddenGuildIds.some(guildId => GuildRoleStore.getRole(guildId, icon.roleId) != null) ? undefined : icon;
    }
});
