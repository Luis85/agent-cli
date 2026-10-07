import { type WriteRequest } from '../domain/file.ts';
import type { FileRepository } from './ports.ts';
import type { Workspace } from './workspace.ts';
export type ComponentKind = 'domain' | 'application';
export interface ProjectMetadata {
    schemaVersion: 1;
    name: string;
    type: 'library';
}
export interface ProjectInfo extends ProjectMetadata {
    directory: string;
}
export interface ProjectScaffolder {
    project(name: string, projectsDirectory: string): readonly WriteRequest[];
    component(projectName: string, componentName: string, projectsDirectory: string, kind: ComponentKind): readonly WriteRequest[];
}
export declare function projectName(name: string): string;
/** Owns project discovery and mutation policy; scaffolding and persistence are injected. */
export declare class ProjectService {
    private readonly files;
    private readonly workspace;
    readonly projectsDirectory: string;
    private readonly scaffolder;
    constructor(files: FileRepository, workspace: Workspace, projectsDirectory: string, scaffolder: ProjectScaffolder);
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
        changes: import("../sdk.ts").FileChange[];
        project: ProjectInfo | null;
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
        project: ProjectInfo | null;
    }>;
    close(): Promise<{
        preview: {
            path: string;
            content: string;
        }[];
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
        project: ProjectInfo | null;
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
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
        changes: import("../sdk.ts").FileChange[];
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
        changes: import("../sdk.ts").FileChange[];
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
        changes: import("../sdk.ts").FileChange[];
        project: ProjectInfo;
        component: {
            name: string;
            kind: "domain" | "application";
        };
    } | {
        preview?: undefined;
        dryRun: boolean;
        changes: import("../sdk.ts").FileChange[];
        project: ProjectInfo;
        component: {
            name: string;
            kind: "domain" | "application";
        };
    }>;
    private contextSnapshot;
    private contextProject;
    private select;
    private preview;
}
