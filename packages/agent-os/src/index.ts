/**
 * arcan-os — Meta-package that re-exports all Arcan OS packages.
 *
 * Install with: bun install arcan-os
 * This gives you access to all @arcan-os/* packages plus the `arcan` CLI command.
 */

export * as Context from '@arcan-os/context';
export * from '@arcan-os/core';
export * as EngineAdapter from '@arcan-os/engine-adapter';
export * as EventStore from '@arcan-os/event-store';
export * as Memory from '@arcan-os/memory';
export * as Observability from '@arcan-os/observability';
export * as RunManager from '@arcan-os/run-manager';
export * as Skills from '@arcan-os/skills';
export * as ToolKernel from '@arcan-os/tool-kernel';
