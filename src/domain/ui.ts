/** Framework-neutral, declarative UI contracts. Bindings use {{propName}}. */
export const uiFrameworks = ['html', 'htmx', 'vanilla', 'vue', 'svelte', 'react', 'angular'] as const;
export type UiFramework = typeof uiFrameworks[number];
export type UiValue = string | number | boolean | null;
export type UiJson = UiValue | UiJson[] | { [key: string]: UiJson };
export interface UiProp { type: 'string' | 'number' | 'boolean'; default?: UiValue; required?: boolean; description?: string }
export interface UiState { type: 'string' | 'number' | 'boolean'; default: UiValue }
export interface UiElement { tag: string; attrs?: Record<string, UiValue>; text?: string; children?: UiNode[]; interactions?: string[] }
export interface UiReference { component: string; props?: Record<string, UiValue>; children?: UiNode[] }
export interface UiSlot { slot: 'children' }
export type UiNode = UiElement | UiReference | UiSlot;
export interface UiStory { name: string; args?: Record<string, UiValue>; parameters?: Record<string, UiJson>; tags?: string[] }
export interface UiStorybook {
  title?: string;
  tags?: string[];
  args?: Record<string, UiValue>;
  argTypes?: Record<string, UiJson>;
  parameters?: Record<string, UiJson>;
  stories?: UiStory[];
  /** Workspace-relative JS/TS module providing native Storybook overrides. */
  extension?: string;
}
export interface UiDefinition {
  schemaVersion: 1;
  id: string;
  name?: string;
  description: string;
  sourcePath: string;
  props: Record<string, UiProp>;
  state?: Record<string, UiState>;
  root: UiNode;
  storybook?: UiStorybook;
}
