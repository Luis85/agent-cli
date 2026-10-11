<script setup lang="ts">
import { computed, ref } from 'vue';
import UBadge from '@nuxt/ui/components/Badge.vue';
import UButton from '@nuxt/ui/components/Button.vue';
import UInput from '@nuxt/ui/components/Input.vue';
import USelect from '@nuxt/ui/components/Select.vue';
import { filterPlugins, type Plugin } from '../system';

const props = defineProps<{ plugins: Plugin[] }>();
const search = ref('');
const state = ref('all');
const filtered = computed(() => filterPlugins(props.plugins, search.value, state.value));
const enabledCount = computed(() => props.plugins.filter(plugin => plugin.state === 'enabled').length);
const states = computed(() => [{ label: 'All states', value: 'all' }, ...[...new Set(props.plugins.map(plugin => plugin.state))].sort().map(value => ({ label: value.charAt(0).toUpperCase() + value.slice(1), value }))]);
function badgeColor(state: string) { return state === 'enabled' ? 'primary' : state === 'failed' ? 'error' : 'neutral'; }
function clearFilters() { search.value = ''; state.value = 'all'; }
</script>

<template>
  <section class="inventory-section plugins-section" aria-labelledby="plugins-heading">
    <div class="section-heading"><h2 id="plugins-heading" aria-label="Plugins">Plugins <span class="item-count">{{ plugins.length }}</span></h2><span class="section-detail">{{ enabledCount }} enabled</span></div>
    <div v-if="plugins.length" class="plugin-filters">
      <UInput v-model="search" aria-label="Search plugins" placeholder="Search plugins" class="plugin-search" :ui="{ base: 'w-full' }" />
      <USelect v-model="state" :items="states" aria-label="Plugin status" class="plugin-state" />
    </div>
    <p v-if="plugins.length && (search || state !== 'all')" class="filter-summary" role="status">{{ filtered.length }} of {{ plugins.length }} plugins</p>
    <ul v-if="filtered.length" class="plugin-list">
      <li v-for="plugin in filtered" :key="plugin.id" class="plugin-row">
        <div class="plugin-heading"><div class="plugin-identity"><h3>{{ plugin.name }}</h3><span class="plugin-version">{{ plugin.version }}</span></div><UBadge :color="badgeColor(plugin.state)" variant="soft" size="sm">{{ plugin.state }}</UBadge></div>
        <p class="plugin-description">{{ plugin.description || 'No description provided.' }}</p>
        <p v-if="plugin.reason" class="plugin-reason">{{ plugin.reason }}</p>
        <div class="plugin-meta"><code>{{ plugin.id }}</code><span>{{ plugin.core ? 'Core' : 'Workspace' }}</span><span>{{ plugin.commands.length }} command{{ plugin.commands.length === 1 ? '' : 's' }}</span><span v-if="plugin.generators.length">{{ plugin.generators.length }} generator{{ plugin.generators.length === 1 ? '' : 's' }}</span><span v-if="plugin.skills.length">{{ plugin.skills.length }} skill{{ plugin.skills.length === 1 ? '' : 's' }}</span></div>
      </li>
    </ul>
    <div v-else class="empty-state">
      <p>{{ plugins.length ? 'No plugins match your filters.' : 'No plugins found in this workspace.' }}</p>
      <UButton v-if="plugins.length" color="neutral" variant="link" @click="clearFilters">Clear filters</UButton>
    </div>
  </section>
</template>
