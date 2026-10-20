/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MonitorIdentity {
    id: string;
    label: string;
    x: number;
    y: number;
}

export function monitorKey(monitor: MonitorIdentity) {
    return `monitor:${encodeURIComponent(monitor.label)}:${monitor.x}:${monitor.y}`;
}

export function isIgnoredMonitor(monitor: MonitorIdentity, ignored: readonly string[], monitors: MonitorIdentity[]) {
    if (ignored.includes(monitor.id) || ignored.includes(monitorKey(monitor))) return true;
    return monitor.label !== "" && monitors.filter(other => other.label === monitor.label).length === 1
        && ignored.some(key => key.startsWith(`monitor:${encodeURIComponent(monitor.label)}:`));
}

export function isIgnoredList(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= 64 && value.every(key => typeof key === "string"
        && (/^-?\d{1,20}$/.test(key) || /^monitor:[^:]{0,768}:-?\d{1,10}:-?\d{1,10}$/.test(key)));
}
