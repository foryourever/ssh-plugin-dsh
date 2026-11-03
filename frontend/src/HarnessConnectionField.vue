<script setup lang="ts">
import { FolderOpen } from '@lucide/vue';
import { translate as t } from './harnessLocale';
defineProps<{field:any;draft:Record<string,any>;clearing:Record<string,boolean>;selectedKey?:string;importing?:boolean}>();
defineEmits<{importKey:[event:Event]}>();
</script>
<template>
  <div class="ssh-field" :data-field="field.key">
    <label :for="`ssh-field-${field.key}`">{{field.label}}<span v-if="field.required"> *</span></label>
    <select v-if="field.type==='select'" :id="`ssh-field-${field.key}`" v-model="draft[field.key]" :required="field.required">
      <option v-for="option in field.options" :key="option.value" :value="option.value">{{option.label}}</option>
    </select>
    <input v-else-if="field.type==='boolean'" :id="`ssh-field-${field.key}`" type="checkbox" v-model="draft[field.key]"/>
    <textarea v-else-if="field.type==='textarea'" :id="`ssh-field-${field.key}`" v-model="draft[field.key]" :required="field.required" :placeholder="field.placeholder" rows="4" spellcheck="false"/>
    <input v-else :id="`ssh-field-${field.key}`" v-model="draft[field.key]" :type="field.type==='password'?'password':field.type==='number'?'number':'text'" :required="field.required" :min="field.key==='port'?1:field.min" :max="field.key==='port'?65535:field.max" :placeholder="field.placeholder" :autocomplete="field.type==='password'?'new-password':'off'"/>
    <template v-if="field.picker?.kind==='file' && field.picker.content_field">
      <div class="ssh-key-picker">
        <label class="ssh-file-button" :class="{'is-disabled':importing}" :for="`ssh-pick-${field.key}`"><FolderOpen :size="16"/>{{t(importing?'Importing…':'Choose file…')}}</label>
        <input :id="`ssh-pick-${field.key}`" class="ssh-key-input" type="file" :disabled="importing" :aria-label="`${t('Choose file…')} ${field.label}`" @change="$emit('importKey',$event)"/>
        <small v-if="selectedKey" role="status" class="ssh-key-name">{{t('Key imported')}}：{{selectedKey}}</small>
      </div>
    </template>
    <small v-if="['secret','password'].includes(field.binding)">{{t('Leave blank to keep the saved value.')}}
      <label class="ssh-secret-clear"><input type="checkbox" v-model="clearing[field.key]"/> {{t('Clear saved value')}}</label>
    </small>
    <small v-if="field.description">{{field.description}}</small>
  </div>
</template>
