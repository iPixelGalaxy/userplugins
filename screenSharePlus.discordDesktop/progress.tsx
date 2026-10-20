/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Paragraph } from "@components/Paragraph";
import { useFixedTimer } from "@utils/react";
import type { PluginNative } from "@utils/types";
import type { RenderModalProps } from "@vencord/discord-types";
import { findComponentByCodeLazy } from "@webpack";
import { closeModal, Modal, openModal, React, useEffect, useState } from "@webpack/common";

import type { PreparationProgress } from "./native";

interface MeterProps {
    progress: number;
    variant: "blue";
    weight: "medium";
    labelledBy: string;
    glowing: boolean;
}

interface ProgressProps extends RenderModalProps {
    cancel(): void;
}

const Meter: React.ComponentType<MeterProps> = findComponentByCodeLazy("--custom-gradient-glow", "labelledBy");
const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;

function PreparationModal({ cancel, ...props }: ProgressProps) {
    const [progress, setProgress] = useState<PreparationProgress>({
        phase: "download", downloaded: 0, totalBytes: 0, completed: 0, totalSteps: 1, status: "Starting screen share preparation."
    });
    const [started] = useState(Date.now);
    const elapsed = useFixedTimer({ initialTime: started });

    useEffect(() => {
        let active = true;
        let pending = false;
        async function refresh() {
            if (pending) return;
            pending = true;
            try {
                const next = await Native.getPreparationProgress();
                if (active) setProgress(next);
            } catch {
                if (active) setProgress((current: PreparationProgress) => ({ ...current, status: "Could not read setup progress. Fully restart Discord and try again." }));
            } finally {
                pending = false;
            }
        }
        void refresh();
        const timer = setInterval(refresh, 250);
        return () => { active = false; clearInterval(timer); };
    }, []);

    const download = progress.totalBytes > 0 ? progress.downloaded / progress.totalBytes * 100 : 0;
    const configuration = progress.totalSteps > 0 ? progress.completed / progress.totalSteps * 100 : 0;
    return (
        <Modal {...props} title="Preparing screen sharing" size="sm" actions={[{ text: "Cancel", variant: "secondary", onClick: cancel }]}>
            <Paragraph id="vc-screenshare-plus-download">Download {Math.round(download)}%</Paragraph>
            <Meter progress={download} variant="blue" weight="medium" labelledBy="vc-screenshare-plus-download" glowing={false} />
            <Paragraph>{(progress.downloaded / 1_000_000).toFixed(1)} MB of {(progress.totalBytes / 1_000_000).toFixed(1)} MB</Paragraph>
            <Paragraph id="vc-screenshare-plus-configure">Capture setup {Math.round(configuration)}%</Paragraph>
            <Meter progress={configuration} variant="blue" weight="medium" labelledBy="vc-screenshare-plus-configure" glowing={false} />
            <Paragraph>{progress.status}</Paragraph>
            <Paragraph>{Math.floor(elapsed / 1000)} seconds elapsed. Setup completes automatically.</Paragraph>
        </Modal>
    );
}

const ProgressModal = ErrorBoundary.wrap(PreparationModal, { noop: true });

export function openPreparationProgress(cancel: () => void) {
    let finished = false;
    function cancelPreparation() {
        if (finished) return;
        finished = true;
        cancel();
        closeModal(key);
    }
    const key = openModal((props: RenderModalProps) => <ProgressModal {...props} cancel={cancelPreparation} />, { onCloseCallback: cancelPreparation });
    return () => { finished = true; closeModal(key); };
}
