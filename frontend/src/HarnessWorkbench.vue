<script setup lang="ts">
import { defineAsyncComponent, provide } from 'vue';
import { createWorkbenchApi, type HarnessWorkbench } from './harnessBridge';
import { workbenchScopeKey } from './lib/workbenchApi';
const props = defineProps<{ entry: HarnessWorkbench; active: boolean }>();
const rootId = `ssh-workbench-${props.entry.id}`;
provide(workbenchScopeKey, { rootId, active: () => props.active, api: createWorkbenchApi(props.entry, () => props.active) });
const App = defineAsyncComponent(() => import('./App.vue'));
const TunnelManager = defineAsyncComponent(() => import('./TunnelManager.vue'));
</script>
<template>
  <div :id="rootId" class="ssh-workbench-scope">
    <App v-if="entry.context.connectionId || entry.context.plugin?.mode === 'local-terminal'"/>
    <TunnelManager v-else :context="entry.context"/>
  </div>
</template>
