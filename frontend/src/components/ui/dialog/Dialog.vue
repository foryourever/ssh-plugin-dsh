<script setup lang="ts">
import type { DialogRootEmits, DialogRootProps } from "reka-ui";
import { DialogRoot, useForwardPropsEmits } from "reka-ui";
import { inject } from "vue";
import { workbenchScopeKey } from "../../../lib/workbenchApi";
const workbenchScope = inject(workbenchScopeKey, null);

const props = defineProps<DialogRootProps>();
const emits = defineEmits<DialogRootEmits>();

const forwarded = useForwardPropsEmits(props, emits);
</script>

<template>
  <DialogRoot v-slot="slotProps" data-slot="dialog" v-bind="forwarded" :open="workbenchScope && !workbenchScope.active() ? false : props.open">
    <slot v-bind="slotProps" />
  </DialogRoot>
</template>
