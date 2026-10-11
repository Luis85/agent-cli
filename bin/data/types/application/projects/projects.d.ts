import { type WriteRequest } from '../../domain/documents/file.ts';
import type { FileRepository } from '../workspace/ports.ts';
import type { Workspace } from '../workspace/workspace.ts';
import type { EventBus } from '../plugins/events.ts';
export type ComponentKind = 'domain' | 'application';
export interface ProjectMetadata {
    schemaVersion: 1;
    name: string;
    type: 'library';
}
export interface ProjectInfo extends ProjectMetadata {
    directory: string;
}
/**
 * The files of a new project and of a project component. The `scaffolds` core plugin provides it as the service
 * `scaffolds.projects`; `project create` and `project component` fail with PLUGIN_UNAVAILABLE without it.
 */
export interface ProjectScaffolder {
    project(name: string, projectsDirectory: string): readonly WriteRequest[];
    component(projectName: string, componentName: string, projectsDirectory: string, kind: ComponentKind): readonly WriteRequest[];
}
export declare const projectScaffolderService = "scaffolds.projects";
/** Resolves the scaffolder when a `project create` or `project component` action needs it. */
export type ProjectScaffolderLookup = (action: 'create' | 'component') => ProjectScaffolder;
export declare function projectName(name: string): string;
/** Owns project discovery and mutation policy; scaffolding and persistence are injected. */
export declare class ProjectService {
    private readonly files;
    private readonly workspace;
    readonly projectsDirectory: string;
    private readonly scaffolder;
    private readonly events;
    constructor(files: FileRepository, workspace: Workspace, projectsDirectory: string, scaffolder: ProjectScaffolderLookup, events: EventBus);
    list(): Promise<ProjectInfo[]>;
    inspect(name: string): Promise<ProjectInfo>;
    current(): Promise<ProjectInfo | null>;
    requireCurrent(): Promise<ProjectInfo>;
    open(name: string): Promise<{
        preview: {
            path: string;
            content: string;
        }[];
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo | null;
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo | null;
    }>;
    close(): Promise<{
        preview: {
            path: string;
            content: string;
        }[];
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo | null;
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo | null;
    }>;
    create(name: string): Promise<{
        nextSteps: ({
            scope: string;
            command: string;
            directory?: undefined;
        } | {
            scope: string;
            directory: string;
            command: string;
        })[];
        preview: {
            path: string;
            content: string;
        }[];
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: {
            schemaVersion: number;
            name: string;
            type: string;
            directory: string;
        };
    } | {
        nextSteps: ({
            scope: string;
            command: string;
            directory?: undefined;
        } | {
            scope: string;
            directory: string;
            command: string;
        })[];
        preview?: undefined;
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: {
            schemaVersion: number;
            name: string;
            type: string;
            directory: string;
        };
    }>;
    component(name: string, componentName: string, kind?: ComponentKind): Promise<{
        preview: {
            path: string;
            content: string;
        }[];
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo;
        component: {
            name: string;
            kind: "domain" | "application";
        };
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: Array<import("../../sdk.ts").FileChange | import("../../sdk.ts").PlannedChange>;
        project: ProjectInfo;
        component: {
            name: string;
            kind: "domain" | "application";
        };
    }>;
    private contextSnapshot;
    private contextProject;
    /** A committed selection change emits `workspace.project-change` with the previous and new project names. */
    private select;
    private preview;
}
