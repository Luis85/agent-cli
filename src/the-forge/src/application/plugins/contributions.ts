import { ensure, isRecord } from '../../domain/shared/errors.ts';
import { defaultIssues, schemaIssues, type JsonSchema } from '../../domain/schema/json-schema.ts';
import { validateCommandMetadata } from './command-metadata.ts';
import { errorPrefix, PluginCatalog } from './plugin-catalog.ts';
import { skillIssues, type SkillFrontmatter } from '../../domain/skills/skill.ts';

/** Reads the YAML frontmatter of a SKILL.md; composition injects a complete YAML parser. */
export type SkillFrontmatterReader = (content: string) => SkillFrontmatter;

export type PluginOrigin = 'core' | 'user';
const hooks = ['onload', 'onUserEnable', 'onExternalSettingsChange', 'onunload', 'validateSettings'] as const;
const lists = ['commands', 'generators', 'events', 'skills'] as const;
const id = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;

/**
 * Validates every contribution of one plugin before anything is registered. User plugins prefix command,
 * generator, event and service ids with `<id>.`, skill ids with `<id>-` and error codes with `<ID>_`; every skill
 * is an Agent Skill whose frontmatter name equals its id. Bundled core plugins may
 * own bare command, generator, skill and service ids, while their events stay in their own `<id>.*` namespace.
 */
export function validateContributions(plugin: Record<string, unknown>, pluginId: string, origin: PluginOrigin, frontmatter: SkillFrontmatterReader): void {
  // Skill ids are Agent Skills folder names, which allow no dots: user plugins prefix them with `<id>-`.
  const inNamespace = (value: string, key?: typeof lists[number]) => value.startsWith(pluginId + (key === 'skills' ? '-' : '.'));
  for (const hook of hooks) ensure(plugin[hook] === undefined || typeof plugin[hook] === 'function', 'INVALID_PLUGIN', `${hook} must be a function.`);
  for (const key of lists) {
    ensure(plugin[key] === undefined || Array.isArray(plugin[key]), 'INVALID_PLUGIN', `${key} must be an array.`);
    for (const contribution of (plugin[key] ?? []) as unknown[]) {
      ensure(isRecord(contribution) && typeof contribution.id === 'string', 'INVALID_PLUGIN', `Invalid ${key} contribution.`);
      const bare = origin === 'core' && key !== 'events';
      ensure(bare || inNamespace(contribution.id, key), 'PLUGIN_NAMESPACE', `Contribution ${contribution.id} must start with ${pluginId}${key === 'skills' ? '-' : '.'}`);
    }
  }
  for (const command of (plugin.commands ?? []) as Record<string, unknown>[]) {
    ensure(typeof command.run === 'function', 'INVALID_PLUGIN', 'Invalid command.');
    validateCommandMetadata(command);
  }
  for (const generator of (plugin.generators ?? []) as Record<string, unknown>[]) validateGenerator(generator);
  for (const skill of (plugin.skills ?? []) as Record<string, unknown>[]) {
    ensure(typeof skill.content === 'string', 'INVALID_PLUGIN', 'Invalid skill.');
    const issues = skillIssues(skill.id as string, frontmatter(skill.content));
    ensure(issues.length === 0, 'INVALID_PLUGIN', issues.join(' '));
  }
  ensure(plugin.provides === undefined || isRecord(plugin.provides), 'INVALID_PLUGIN', 'provides must map service ids to implementations.');
  for (const key of ['requires', 'optional']) {
    const services = plugin[key];
    ensure(services === undefined || (Array.isArray(services) && services.every(service => typeof service === 'string' && id.test(service))), 'INVALID_PLUGIN', `${key} must list service ids.`);
  }
  for (const service of Object.keys((plugin.provides ?? {}) as object)) {
    ensure(id.test(service), 'DUPLICATE_OR_INVALID_ID', service);
    // Core plugins too: a service id names its provider, so a disabled provider is known without running it.
    ensure(inNamespace(service), 'PLUGIN_NAMESPACE', `Service ${service} must start with ${pluginId}.`);
  }
  ensure(plugin.validateSettings === undefined || plugin.settings !== undefined, 'INVALID_PLUGIN', 'validateSettings requires settings.');
  ensure(plugin.settings === undefined || (isRecord(plugin.settings) && plugin.settings.type === 'object' && schemaIssues(plugin.settings).length === 0), 'INVALID_PLUGIN', `settings must be a supported JSON Schema of type object: ${schemaIssues(plugin.settings).join('; ')}`);
  const defaults = plugin.settings === undefined ? [] : defaultIssues(plugin.settings as JsonSchema, 'settings');
  ensure(defaults.length === 0, 'INVALID_PLUGIN', `settings defaults must satisfy their own schemas: ${defaults.join('; ')}`);
  const owned = (key: typeof lists[number]) => ((plugin[key] ?? []) as Array<{ id: string }>).map(item => item.id);
  const actions = ((plugin.commands ?? []) as Array<{ id: string; actions?: object }>).flatMap(command => Object.keys(command.actions ?? {}).map(action => `${command.id} ${action}`));
  PluginCatalog.validate(pluginId, plugin.strings, plugin.errors, { commands: owned('commands'), actions, generators: owned('generators'), events: owned('events') }, origin === 'core' ? null : errorPrefix(pluginId));
}

function validateGenerator(generator: Record<string, unknown>): void {
  const run = typeof generator.run === 'function', generate = typeof generator.generate === 'function';
  ensure(run !== generate && typeof generator.description === 'string', 'INVALID_PLUGIN', 'A generator requires a description and exactly one of generate or run.');
  ensure(generator.directory === undefined || typeof generator.directory === 'string', 'INVALID_PLUGIN', 'Generator directory must be a string.');
  for (const key of ['fixedDirectory', 'review']) ensure(generator[key] === undefined || typeof generator[key] === 'boolean', 'INVALID_PLUGIN', `Generator ${key} must be a boolean.`);
  // Generators share command metadata rules; their usage defaults to make <id> <Name>.
  validateCommandMetadata({ ...generator, usage: generator.usage ?? `make ${String(generator.id)} <Name>` });
}
