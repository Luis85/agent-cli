<script setup lang="ts">
import { computed } from 'vue';
import UApp from '@nuxt/ui/components/App.vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import USwitch from '@nuxt/ui/components/Switch.vue';
import PluginList from './components/PluginList.vue';
import { useSystem } from './composables/useSystem';
import { formatUptime } from './system';

const { snapshot, connection, refreshing, autoRefresh, lastUpdated, refresh } = useSystem();
const connectionLabel = computed(() => ({
  loading: 'Connecting', connected: 'Connected', disconnected: 'Disconnected',
  unauthorized: 'Authentication required', invalid: 'Response unavailable',
})[connection.value]);
const project = computed(() => snapshot.value?.availability.selectedProject ? snapshot.value.workspace.selectedProject : null);
</script>

<template>
  <UApp>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="topbar">
      <div class="brand">The Forge <span class="brand-divider" aria-hidden="true">/</span> <span class="brand-section">Admin</span></div>
      <UBadge color="neutral" variant="subtle" size="sm">Read-only</UBadge>
    </header>
    <main id="main" tabindex="-1" class="page">
      <div class="page-heading">
        <div>
          <h1>Developer admin</h1>
          <p class="intro">A live view of your local workspace.</p>
        </div>
        <div class="refresh-controls">
          <USwitch v-model="autoRefresh" label="Auto-refresh" size="sm" />
          <UButton color="neutral" variant="outline" :disabled="refreshing || connection === 'unauthorized'" @click="refresh">
            {{ refreshing ? 'Refreshing…' : 'Refresh' }}
          </UButton>
        </div>
      </div>
      <div class="connection-row">
        <div role="status" aria-label="Connection status" class="connection-status">
          <span class="status-dot" :class="{ 'is-connected': connection === 'connected' }" aria-hidden="true"></span>
          {{ connectionLabel }}
        </div>
        <p v-if="lastUpdated" class="last-updated">{{ connection === 'connected' ? 'Updated' : 'Last updated' }} <time :datetime="snapshot?.updatedAt">{{ lastUpdated }}</time><span v-if="autoRefresh && connection === 'connected'"> · Every 15 seconds</span></p>
      </div>

      <section v-if="connection === 'unauthorized'" role="alert" class="notice notice-warning">
        <h2>Open a fresh admin link</h2>
        <p>This link is missing its access token, or the local server has restarted. Ask your agent to run <code>node bin/forge.js server start --webview admin</code> and open the returned URL.</p>
        <p v-if="snapshot">The view below is the last successful snapshot.</p>
      </section>
      <section v-else-if="connection === 'disconnected'" role="alert" class="notice notice-warning">
        <h2>Server unavailable</h2>
        <p>Check that the local server is running, then select Refresh. Your agent can check with <code>node bin/forge.js server status</code>.</p>
        <p v-if="snapshot">The view below is the last successful snapshot.</p>
      </section>
      <section v-else-if="connection === 'invalid'" role="alert" class="notice notice-warning">
        <h2>System response could not be read</h2>
        <p>Refresh to try again. If this continues, update the CLI and its webview assets together.</p>
        <p v-if="snapshot">The view below is the last successful snapshot.</p>
      </section>
      <p v-else-if="!snapshot" role="status" class="loading-state">Loading workspace state…</p>

      <template v-if="snapshot">
        <section v-if="snapshot.warnings.length" aria-label="System warnings" class="notice notice-warning">
          <h2>System needs attention</h2>
          <ul><li v-for="warning in snapshot.warnings" :key="warning">{{ warning }}</li></ul>
        </section>
        <div class="workspace-layout">
          <aside class="context-column" aria-label="System context">
            <section class="context-section" aria-labelledby="workspace-heading">
              <h2 id="workspace-heading">Workspace</h2>
              <dl class="context-details">
                <div><dt>Root directory</dt><dd class="path">{{ snapshot.workspace.root }}</dd></div>
                <div><dt>Selected project</dt><dd class="selected-project">{{ !snapshot.availability.selectedProject ? 'Selection unavailable' : project?.name ?? 'No project selected' }}</dd><dd v-if="project" class="path">{{ project.directory }}</dd></div>
                <div><dt>Projects directory</dt><dd class="path">{{ snapshot.availability.config ? snapshot.workspace.projectsPath : 'Configuration unavailable' }}</dd></div>
              </dl>
              <p v-if="snapshot.availability.selectedProject && !project" class="context-hint">The CLI is using workspace scope.</p>
            </section>
            <section class="context-section" aria-labelledby="runtime-heading">
              <h2 id="runtime-heading">Runtime</h2>
              <dl class="runtime-details">
                <div><dt>Forge</dt><dd>{{ snapshot.server.version }}</dd></div>
                <div><dt>Node.js</dt><dd>{{ snapshot.server.nodeVersion }}</dd></div>
                <div><dt>Address</dt><dd>{{ snapshot.server.host }}:{{ snapshot.server.port }}</dd></div>
                <div><dt>Process</dt><dd>{{ snapshot.server.pid }}</dd></div>
                <div><dt>Uptime</dt><dd>{{ formatUptime(snapshot.server.uptimeSeconds) }}</dd></div>
              </dl>
            </section>
            <section class="context-section" aria-labelledby="capabilities-heading">
              <h2 id="capabilities-heading">Available capabilities</h2>
              <dl v-if="snapshot.availability.capabilities" class="runtime-details">
                <div><dt>Commands</dt><dd>{{ snapshot.stats.commands }}</dd></div>
                <div><dt>Generators</dt><dd>{{ snapshot.stats.generators }}</dd></div>
                <div><dt>Skills</dt><dd>{{ snapshot.stats.skills }}</dd></div>
              </dl>
              <p v-else class="context-hint">Capability counts unavailable.</p>
            </section>
          </aside>
          <div class="inventory-column">
            <section class="inventory-section" aria-labelledby="projects-heading">
              <div class="section-heading"><h2 id="projects-heading">Projects <span v-if="snapshot.availability.projects" class="item-count">{{ snapshot.projects.length }}</span></h2><span class="section-detail">Workspace inventory</span></div>
              <p v-if="!snapshot.availability.projects" class="empty-state">Project inventory unavailable.</p>
              <ul v-else-if="snapshot.projects.length" class="project-list">
                <li v-for="item in snapshot.projects" :key="item.directory" class="project-row">
                  <div class="project-info"><span class="project-name">{{ item.name }}</span><span class="path">{{ item.directory }}</span></div>
                  <div class="project-tags"><span class="project-type">{{ item.type }}</span><UBadge v-if="item.directory === project?.directory" color="primary" variant="soft" size="sm">Selected</UBadge></div>
                </li>
              </ul>
              <p v-else class="empty-state">No projects found in this workspace.</p>
            </section>
            <PluginList v-if="snapshot.availability.plugins" :plugins="snapshot.plugins" />
            <section v-else class="inventory-section" aria-labelledby="plugins-unavailable-heading">
              <div class="section-heading"><h2 id="plugins-unavailable-heading">Plugins</h2></div>
              <p class="empty-state">Plugin inventory unavailable.</p>
            </section>
          </div>
        </div>
        <footer class="page-footer">Changes are managed through the CLI. This view only reads system state.</footer>
      </template>
    </main>
  </UApp>
</template>
