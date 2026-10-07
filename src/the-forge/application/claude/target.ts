import type { Workspace } from '../workspace/workspace.ts';

export interface ClaudeTarget {
  workspace: Workspace;
  scope: 'project' | 'local' | 'user' | 'plugin';
  directory: string;
  agentsDirectory: string;
  settingsPath: string;
}
