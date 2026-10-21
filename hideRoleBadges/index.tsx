/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Guild } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

const settings = definePluginSettings({}).withPrivateSettings<{
    hiddenGuildIds?: string[];
}>();

const SETTING_KEYS: ["hiddenGuildIds"] = ["hiddenGuildIds"];

interface RoleIconContext {
    guildId?: string;
    guild?: Guild;
}

export default definePlugin({
    name: "HideRoleBadges",
    description: "Hide role icons in chat and the member list for selected servers.",
    authors: [Devs.Ven],
    tags: ["Appearance", "Chat"],
    settings,

    settingsAboutComponent: () => (
        <Paragraph>
            Right-click a server and toggle Hide Role Badges to hide its image and emoji role icons.
            Each server is configured separately, and your choices are saved.
        </Paragraph>
    ),

    patches: [
        {
            find: ".customIconSrc,name:",
            replacement: {
                match: /(?<=return )\i\.useMemo\(\(\)=>\i\(\i(?:,\i)?\),\[\i(?:,\i)?\]\)/g,
                replace: "$self.useRoleIcon(arguments[0],$&)"
            }
        }
    ],

    contextMenus: {
        "guild-context"(children, { guild }: { guild?: Guild; }) {
            if (!guild) return;

            const hiddenGuildIds = settings.plain.hiddenGuildIds ?? [];
            const hidden = hiddenGuildIds.includes(guild.id);
            children.push(
                <Menu.MenuCheckboxItem
                    id="vc-hide-role-badges"
                    label="Hide Role Badges"
                    checked={hidden}
                    action={() => {
                        const guildIds = settings.plain.hiddenGuildIds ?? [];
                        settings.store.hiddenGuildIds = guildIds.includes(guild.id)
                            ? guildIds.filter(id => id !== guild.id)
                            : [...guildIds, guild.id];
                    }}
                />
            );
        }
    },

    useRoleIcon<T>(context: string | RoleIconContext | undefined, icon: T) {
        const { hiddenGuildIds = [] } = settings.use(SETTING_KEYS);
        const guildId = typeof context === "string" ? context : context?.guildId ?? context?.guild?.id;
        return guildId && hiddenGuildIds.includes(guildId) ? undefined : icon;
    }
});
