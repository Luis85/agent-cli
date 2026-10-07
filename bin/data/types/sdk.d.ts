export type { Plugin, PluginManifest, PluginContributions, Command, CommandContext, Generator, Skill } from './application/plugins/registry.ts';
export type { EventDefinition, EventRecord } from './application/plugins/events.ts';
export type { HostEventMap, HostEventId, HostEventRecord } from './application/plugins/host-events.ts';
export type { FileSnapshot, FileChange, WriteRequest } from './domain/documents/file.ts';
export type { FileRepository, DocumentCodec } from './application/workspace/ports.ts';
export type { ClaudeLifecycleClient, ClaudeLifecycleRequest, ClaudeLifecycleResult, ClaudeLifecyclePlan, ClaudeOutput } from './application/claude/lifecycle.ts';
