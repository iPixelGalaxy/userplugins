/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { FormSwitch } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import type { Dev } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { Margins } from "@utils/margins";
import definePlugin from "@utils/types";
import { saveFile } from "@utils/web";
import type { CustomEmoji, Emoji, Guild, RenderModalProps } from "@vencord/discord-types";
import { closeModal, EmojiStore, GuildStore, IconUtils, lodash, Menu, Modal, openModal, SearchableSelect, SelectedGuildStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import { zipSync } from "fflate";

const Devs = { iPixelGalaxy: { name: "iPixelGalaxy", id: 0n } } satisfies Record<string, Dev>;
const logger = new Logger("EmoteExtractor");
const activeExports = new Set<AbortController>();
let modalKey: string | undefined;

function sanitizeName(name: string) {
    return name.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").replace(/[. ]+$/g, "").slice(0, 100) || "emotes";
}

function collectEmotes(guildId: string, recent: boolean, favorites: boolean) {
    const emojis: Emoji[] = guildId ? [...EmojiStore.getGuildEmoji(guildId)] : [];
    if (recent || favorites) {
        const context = EmojiStore.getDisambiguatedEmojiContext();
        if (recent) emojis.push(...context.getFrequentlyUsedEmojisWithoutFetchingLatest());
        if (favorites) emojis.push(...context.favoriteEmojisWithoutFetchingLatest);
    }
    const unique = new Map<string, CustomEmoji>();
    for (const emoji of emojis) {
        if (emoji.type === 1) unique.set(emoji.id, emoji);
    }
    return [...unique.values()];
}

interface ExtractorModalProps {
    modalProps: RenderModalProps;
    initialGuildId: string;
}

const ExtractorModal = ErrorBoundary.wrap(function ExtractorModal({ modalProps, initialGuildId }: ExtractorModalProps) {
    const [guildId, setGuildId] = useState(initialGuildId);
    const [recent, setRecent] = useState(false);
    const [favorites, setFavorites] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [status, setStatus] = useState("");
    const controller = useRef<AbortController | null>(null);
    const guilds = useStateFromStores([GuildStore], () => Object.values(GuildStore.getGuilds()), [], lodash.isEqual);
    const count = useStateFromStores([EmojiStore], () => collectEmotes(guildId, recent, favorites).length, [guildId, recent, favorites]);
    const options = [
        { label: "No server (recent or favorites only)", value: "" },
        ...guilds.toSorted((a, b) => a.name.localeCompare(b.name)).map(guild => ({ label: guild.name, value: guild.id }))
    ];

    useEffect(() => () => controller.current?.abort(), []);

    async function exportEmotes() {
        if (controller.current) return;
        const emojis = collectEmotes(guildId, recent, favorites);
        if (!emojis.length) {
            setStatus("No custom emotes found in the selected sources.");
            return;
        }

        const abort = new AbortController();
        controller.current = abort;
        activeExports.add(abort);
        setExporting(true);
        setStatus(`Downloading 0 of ${emojis.length} emotes.`);
        const files: Record<string, Uint8Array> = {};
        let completed = 0;
        let failed = 0;

        try {
            for (let offset = 0; offset < emojis.length; offset += 4) {
                abort.signal.throwIfAborted();
                await Promise.all(emojis.slice(offset, offset + 4).map(async emoji => {
                    try {
                        const extension = emoji.animated ? "gif" : "png";
                        const url = new URL(IconUtils.getEmojiURL({ id: emoji.id, animated: emoji.animated, size: 512, forcePNG: !emoji.animated }));
                        url.pathname = url.pathname.replace(/\.[^/.]+$/, `.${extension}`);
                        url.searchParams.delete("animated");
                        url.searchParams.set("quality", "lossless");
                        const response = await fetch(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]) });
                        if (!response.ok) throw new Error(`Download failed (${response.status}).`);
                        const blob = await response.blob();
                        if (blob.type !== `image/${extension}`) throw new Error("The download returned an unexpected image format.");
                        files[`${sanitizeName(emoji.name)}_${emoji.id}.${extension}`] = new Uint8Array(await blob.arrayBuffer());
                    } catch (error) {
                        if (abort.signal.aborted) return;
                        failed++;
                        logger.warn(`Could not download emote ${emoji.id}.`, error);
                    }
                    if (abort.signal.aborted) return;
                    completed++;
                    setStatus(`Downloading ${completed} of ${emojis.length} emotes${failed ? ` (${failed} failed)` : ""}.`);
                }));
            }

            abort.signal.throwIfAborted();
            const saved = Object.keys(files).length;
            if (!saved) {
                setStatus("No emotes could be downloaded. Try again.");
                return;
            }
            setStatus("Creating ZIP archive.");
            const archive = zipSync(files, { level: 0 });
            const sources = [guildId && GuildStore.getGuild(guildId)?.name, recent && "recent", favorites && "favorites"].filter(Boolean).join("_");
            saveFile(new File([archive], `${sanitizeName(sources)}_emotes.zip`, { type: "application/zip" }));
            setStatus(`Saved ${saved} emotes${failed ? `. ${failed} emotes could not be downloaded` : ""}.`);
        } catch (error) {
            if (abort.signal.aborted) {
                setStatus("Export canceled.");
            } else {
                logger.error("Could not export emotes.", error);
                setStatus("Could not create the ZIP archive. Try again.");
            }
        } finally {
            abort.abort();
            activeExports.delete(abort);
            controller.current = null;
            setExporting(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            title="Emote Extractor"
            actions={[
                { text: exporting ? "Cancel export" : "Close", variant: "secondary", onClick: () => exporting ? controller.current?.abort() : modalProps.onClose() },
                { text: "Download ZIP", variant: "primary", disabled: exporting || !count, loading: exporting, onClick: () => void exportEmotes() }
            ]}
        >
            <Paragraph className={Margins.bottom16}>
                Export custom emotes as GIFs and PNGs. Combine a server, recent emotes, and favorites in one ZIP. Duplicate emotes are saved once.
            </Paragraph>
            <Heading>Server</Heading>
            <SearchableSelect
                options={options}
                value={guildId}
                placeholder="Select a server"
                maxVisibleItems={6}
                closeOnSelect
                isDisabled={exporting}
                onChange={(value: string) => setGuildId(value)}
            />
            <FormSwitch
                className={Margins.top16}
                title="Include recent emotes"
                description="Use the emotes in Discord's recent picker."
                value={recent}
                onChange={setRecent}
                disabled={exporting}
            />
            <FormSwitch
                title="Include favorite emotes"
                value={favorites}
                onChange={setFavorites}
                disabled={exporting}
                hideBorder
            />
            <Paragraph>{count} unique custom emotes selected.</Paragraph>
            {status ? <Paragraph role="status" aria-live="polite">{status}</Paragraph> : null}
        </Modal>
    );
});

function openExtractor(guildId = SelectedGuildStore.getGuildId() ?? "") {
    if (modalKey) closeModal(modalKey);
    modalKey = openModal(props => <ExtractorModal modalProps={props} initialGuildId={guildId} />, {
        onCloseCallback: () => { modalKey = undefined; }
    });
}

const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => {
    if (!guild) return;
    children.push(
        <Menu.MenuGroup key="emote-extractor">
            <Menu.MenuItem id="emote-extractor" label="Extract emotes" action={() => openExtractor(guild.id)} />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "EmoteExtractor",
    description: "Download a server's emotes, your recent emotes, and favorites as GIFs and PNGs in a ZIP archive.",
    authors: [Devs.iPixelGalaxy],
    tags: ["Emotes", "Servers", "Utility"],
    searchTerms: ["emoji", "emojis", "export", "zip", "favorites", "recent"],
    settingsAboutComponent: () => <Button onClick={() => openExtractor()}>Open Emote Extractor</Button>,
    toolboxActions: { "Extract emotes": () => openExtractor() },
    contextMenus: { "guild-context": guildMenu, "guild-header-popout": guildMenu },
    stop() {
        for (const controller of activeExports) controller.abort();
        if (modalKey) closeModal(modalKey);
    }
});
