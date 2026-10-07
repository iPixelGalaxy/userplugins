/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { TooltipContainer } from "@components/TooltipContainer";
import { classes } from "@utils/misc";
import type { IconComponent } from "@utils/types";
import { ContextMenuApi, Menu, useEffect, useState } from "@webpack/common";

import { setOutgoingMode } from "./outgoingMode";
import { settings } from "./settings";
import { openTranslateModal } from "./TranslateModal";
import { cl } from "./utils";

export const TranslateIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg viewBox="0 96 960 960" height={height} width={width} className={classes(cl("icon"), className)}>
        <path fill="currentColor" d="m475 976 181-480h82l186 480h-87l-41-126H604l-47 126h-82Zm151-196h142l-70-194h-2l-70 194Zm-466 76-55-55 204-204q-38-44-67.5-88.5T190 416h87q17 33 37.5 62.5T361 539q45-47 75-97.5T487 336H40v-80h280v-80h80v80h280v80H567q-22 69-58.5 135.5T419 598l98 99-30 81-127-122-200 200Z" />
    </svg>
);

export let setShouldShowTranslateEnabledTooltip: ((show: boolean) => void) | undefined;

const OUTGOING_MODE_KEYS = ["outgoingMode", "rememberOutgoingModePerChannel", "outgoingModesByChannel"] satisfies Array<keyof typeof settings.store>;

function OutgoingModeMenu({ channelId, close }: { channelId: string; close: () => void; }) {
    const { outgoingMode, rememberOutgoingModePerChannel, outgoingModesByChannel } = settings.use(OUTGOING_MODE_KEYS);
    const mode = rememberOutgoingModePerChannel ? outgoingModesByChannel?.[channelId] ?? "off" : outgoingMode;
    return (
        <Menu.Menu navId="vc-translate-plus-mode" onClose={close} aria-label="Translate mode">
            <Menu.MenuGroup label="Outgoing translation">
                {(["off", "translated", "both"] as const).map(value => (
                    <Menu.MenuRadioItem
                        key={value}
                        id={`vc-translate-plus-${value}`}
                        group="vc-translate-plus-mode"
                        label={value === "off" ? "Off" : value === "translated" ? "Translated only" : "Both original and translated"}
                        checked={mode === value}
                        action={() => setOutgoingMode(channelId, value)}
                    />
                ))}
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

export const TranslateChatBarIcon: ChatBarButtonFactory = ({ isMainChat, channel }) => {
    const { outgoingMode, rememberOutgoingModePerChannel, outgoingModesByChannel } = settings.use(OUTGOING_MODE_KEYS);
    const [showEnabledTooltip, setShowEnabledTooltip] = useState(false);
    useEffect(() => {
        setShouldShowTranslateEnabledTooltip = setShowEnabledTooltip;
        return () => setShouldShowTranslateEnabledTooltip = undefined;
    }, []);
    if (!isMainChat) return null;

    const channelId = channel.id;
    const mode = rememberOutgoingModePerChannel ? outgoingModesByChannel?.[channelId] ?? "off" : outgoingMode;
    const toggle = () => setOutgoingMode(channelId, mode === "off" ? "translated" : "off");
    const button = (
        <ChatBarButton
            tooltip="Open Translate settings"
            onClick={event => event.shiftKey ? toggle() : openTranslateModal()}
            onContextMenu={event => ContextMenuApi.openContextMenu(event, () => <OutgoingModeMenu channelId={channelId} close={ContextMenuApi.closeContextMenu} />)}
            buttonProps={{ "aria-haspopup": "dialog" }}
        >
            <TranslateIcon className={cl({ "auto-translate": mode !== "off", "chat-button": true })} />
        </ChatBarButton>
    );
    return showEnabledTooltip && settings.store.showAutoTranslateTooltip ? <TooltipContainer text="Auto Translate Enabled" forceOpen>{button}</TooltipContainer> : button;
};
