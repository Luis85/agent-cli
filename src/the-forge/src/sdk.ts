export type { Plugin, PluginManifest, PluginContributions, Command, CommandContext, Generator, Skill } from './application/plugins/registry.ts';
export type { EventDefinition, EventRecord, EventChannel } from './application/plugins/events.ts';
export type { HostEventMap, HostEventId, HostEventRecord, VaultChange, VaultFileChange, VaultFolderChange, VaultRename, CachedMetadataRecord } from './application/plugins/host-events.ts';
export type { FileSnapshot, FileChange, PlannedChange, WriteRequest } from './domain/documents/file.ts';
export type { WriteOptions } from './application/workspace/workspace.ts';
export type { FileRepository, DocumentCodec, WriteBatchResult } from './application/workspace/ports.ts';
export type { ClaudeLifecycleClient, ClaudeLifecycleRequest, ClaudeLifecycleResult, ClaudeLifecyclePlan, ClaudeOutput } from './application/claude/lifecycle.ts';
