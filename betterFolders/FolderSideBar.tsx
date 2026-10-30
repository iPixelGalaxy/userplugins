/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import ErrorBoundary from "@components/ErrorBoundary";
import { findByCodeLazy, findComponentByCodeLazy } from "@webpack";
import { Animations, ChannelRTCStore, ExpandedGuildFolderStore, SortedGuildStore, useCallback, useRef, useState, useStateFromStores } from "@webpack/common";
import type { CSSProperties, ReactNode, RefObject } from "react";

import { settings } from ".";

const GuildsBar = findComponentByCodeLazy('("guildsnav")');
const SIDEBAR_SETTINGS = ["sidebarAnim"] as const;
const useResizeObserver = findByCodeLazy<(
    ref: RefObject<Element | null>,
    callback: (size: { width: number; height: number; }) => void,
    deps?: unknown[]
) => void>("borderBoxSize", "blockSize", "inlineSize");

interface SidebarContentProps {
    children: ReactNode;
    onResize: (width: number) => void;
}

function SidebarContent({ children, onResize }: SidebarContentProps) {
    const ref = useRef<HTMLDivElement>(null);
    const handleResize = useCallback(({ width }: { width: number; }) => onResize(width), [onResize]);
    useResizeObserver(ref, handleResize);

    return <div ref={ref} className="vc-betterFolders-sidebar-content">{children}</div>;
}

function getExpandedFolderIds() {
    const expandedFolders = ExpandedGuildFolderStore.getExpandedFolders();
    const folders = SortedGuildStore.getGuildFolders();

    const expandedFolderIds = new Set<number>();

    for (const folder of folders) {
        if (folder.folderId != null && expandedFolders.has(folder.folderId) && folder.guildIds.length) {
            expandedFolderIds.add(folder.folderId);
        }
    }

    return expandedFolderIds;
}

export default ErrorBoundary.wrap(guildsBarProps => {
    const { sidebarAnim } = settings.use(SIDEBAR_SETTINGS);
    const [sidebarWidth, setSidebarWidth] = useState(0);
    const expandedFolderIds = useStateFromStores([ExpandedGuildFolderStore, SortedGuildStore], () => getExpandedFolderIds());
    const isFullscreen = useStateFromStores([ChannelRTCStore], () => ChannelRTCStore.isFullscreenInContext());

    const Sidebar = (
        <SidebarContent onResize={setSidebarWidth}>
            <GuildsBar
                {...guildsBarProps}
                isBetterFolders={true}
                betterFoldersExpandedIds={expandedFolderIds}
            />
        </SidebarContent>
    );

    const visible = !!expandedFolderIds.size;

    // We need to display none if we are in fullscreen. Yes this seems horrible doing with css, but it's literally how Discord does it.
    const sidebarStyle = {
        display: isFullscreen ? "none" : "flex"
    } satisfies CSSProperties;

    if (!sidebarAnim) {
        return visible
            ? <div className="vc-betterFolders-sidebar" style={sidebarStyle}>{Sidebar}</div>
            : null;
    }

    return (
        <Animations.Transition
            items={visible}
            from={{ width: 0 }}
            enter={{ width: sidebarWidth }}
            update={{ width: sidebarWidth }}
            leave={{ width: 0 }}
            config={{ duration: 200 }}
        >
            {(animationStyle: CSSProperties, show: boolean) =>
                show && (
                    <Animations.animated.div className="vc-betterFolders-sidebar" style={{ ...animationStyle, ...sidebarStyle }}>
                        {Sidebar}
                    </Animations.animated.div>
                )
            }
        </Animations.Transition>
    );
}, { noop: true });
