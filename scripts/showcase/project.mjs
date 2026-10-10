/** Fixed inputs shared by every showcase generation step. */
export const project = {
  id: 'forge-showcase',
  directory: 'src/forge-showcase',
  product: 'Trailhead',
  owner: 'Trailhead product team',
  /** Fixed clock for every template rendering, so regeneration is byte-stable. */
  date: '2026-10-10T09:00:00Z',
};

/**
 * Workspace-relative library directories. `components`, `interactions` and
 * `data-sources` are workspace-scoped commands, so the showcase passes
 * explicit libraries inside the project instead of the workspace defaults.
 */
export const libraries = {
  components: `${project.directory}/library/components`,
  interactions: `${project.directory}/library/interactions`,
  dataSources: `${project.directory}/library/data-sources`,
};
