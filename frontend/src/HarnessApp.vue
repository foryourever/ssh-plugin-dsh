<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { Plus, Server, Pencil, PlugZap, Unplug, Trash2, ArrowLeft, Terminal, RefreshCw, Search, X } from '@lucide/vue';
import HarnessConnectionField from './HarnessConnectionField.vue';
import { connectionFields, translate as t } from './harnessLocale';
import { bridgeState, hostCall, closeWorkbench, openContext, updateContext } from './harnessBridge';
const App = defineAsyncComponent(() => import('./App.vue'));
const TunnelManager = defineAsyncComponent(() => import('./TunnelManager.vue'));
const connections=ref<any[]>([]), fields=ref<any[]>([]), loading=ref(true), busy=ref(false), error=ref(''), search=ref(''), editing=ref(false), manager=ref(true), draft=reactive<Record<string,any>>({}), advanced=ref('{}'), promptValue=ref('');
const selectedKey=ref(''), importingKey=ref(false);
let editGeneration=0;
const clearing=reactive<Record<string,boolean>>({});
const active=computed(()=>bridgeState.context.connectionId || bridgeState.context.plugin?.mode==='local-terminal');
const filtered=computed(()=>connections.value.filter(row=>[row.name,row.host,row.username].some(value=>String(value||'').toLowerCase().includes(search.value.toLowerCase()))));
const visible=(condition:any):boolean=>!condition || (condition.all_of?condition.all_of.every(visible):condition.any_of?condition.any_of.some(visible):condition.not?!visible(condition.not):condition.one_of?condition.one_of.some((value:any)=>String(value)===String(draft[condition.field])):condition.equals!==undefined?draft[condition.field]===condition.equals:true);
const visibleFields=computed(()=>fields.value.filter(field=>visible(field.visible_when) && !(field.key==='password' && draft.protocol==='ssh' && !['password','private-key-password','auto'].includes(draft.authentication))));
const basicKeys=new Set(['display_name','protocol','host','port','username','authentication','password_source','password','private_key','private_key_path','private_key_passphrase']);
const basicFields=computed(()=>visibleFields.value.filter(field=>basicKeys.has(field.key)));
const otherFields=computed(()=>visibleFields.value.filter(field=>!basicKeys.has(field.key)));
watch(()=>bridgeState.generation,()=>{if(active.value)manager.value=false;});
watch(()=>bridgeState.prompt,()=>{const first=bridgeState.prompt?.options?.[0];promptValue.value=typeof first==='string'?first:first?.value||'';});
async function refresh(){loading.value=true;error.value='';try{const [records,manifest,capabilities]=await Promise.all([hostCall<any>('connections.list'),hostCall<any>('manifest'),hostCall<any>('capabilities')]);Object.assign(window.dbxPlugin.capabilities!,capabilities);connections.value=records.connections||[];fields.value=connectionFields(manifest).map((field:any)=>({...field,...(field.key==='private_key_path'?{description:t('Enter a key path on the Harness machine, or choose a file to import its contents below. Provide a path or key content.')}:field.key==='private_key'?{description:t('Paste or import an OpenSSH, PEM or PPK private key. Saved keys are stored as credentials and never shown again; content takes precedence over the path.')}:{})}));}catch(cause){error.value=String(cause);}finally{loading.value=false;}}
function edit(record?:any){editGeneration++;selectedKey.value='';error.value='';for(const key of Object.keys(clearing))delete clearing[key];for(const key of Object.keys(draft))delete draft[key];for(const field of fields.value)draft[field.key]=field.key==='display_name'?t(field.default):field.default??(field.type==='boolean'?false:'');if(record){Object.assign(draft,record.external_config||{},record);draft.display_name=record.name;for(const field of fields.value){if(['password','secret'].includes(field.binding)||field.type==='password')draft[field.key]='';}}draft.id=record?.id||crypto.randomUUID();advanced.value=JSON.stringify(record?.external_config||{},null,2);editing.value=true;}
async function save(){busy.value=true;error.value='';try{const external_config=JSON.parse(advanced.value);if(!external_config||typeof external_config!=='object'||Array.isArray(external_config))throw new Error(t('Advanced configuration must be a JSON object.'));const connection:any={id:draft.id,name:draft.display_name,external_config};const secretSlots:Record<string,any>={};for(const field of fields.value){const value=clearing[field.key]?'':draft[field.key];if(field.binding==='config'){if(value!==undefined)external_config[field.key]=value;}else if(field.binding==='name')connection.name=value;else if(field.binding==='secret'){if(value!==''||clearing[field.key])secretSlots[field.secret_slot||field.key]=value;}else if(field.binding&&(value!==''||clearing[field.key]))connection[field.binding]=value;}await hostCall('connections.save',{connection,secretSlots});editing.value=false;await refresh();}catch(cause){error.value=String(cause);}finally{busy.value=false;}}
async function connect(record:any){if(bridgeState.context.connectionId===record.id){manager.value=false;return;}busy.value=true;error.value='';try{await closeWorkbench();updateContext({});await nextTick();const context=await hostCall<any>('connections.connect',{id:record.id});updateContext(context);manager.value=false;}catch(cause){error.value=String(cause);}finally{busy.value=false;}}
async function disconnect(){busy.value=true;try{const id=bridgeState.context.connectionId;await closeWorkbench();updateContext({});await nextTick();if(id)await hostCall('connections.disconnect',{id});manager.value=true;}catch(cause){error.value=String(cause);}finally{busy.value=false;}}
const deleting=ref<any>(null);
async function remove(){busy.value=true;try{if(bridgeState.context.connectionId===deleting.value.id)await disconnect();await hostCall('connections.delete',{id:deleting.value.id});deleting.value=null;await refresh();}catch(cause){error.value=String(cause);}finally{busy.value=false;}}
async function local(){if(bridgeState.context.plugin?.mode==='local-terminal'){manager.value=false;return;}await openContext({plugin:{mode:'local-terminal'},workbenchId:crypto.randomUUID(),surface:'tab'});manager.value=false;}
async function resolvePrompt(action:string,value?:string){try{await hostCall('prompts.resolve',{id:bridgeState.prompt.id,action,value});bridgeState.prompt=null;}catch(cause){error.value=String(cause);}}
async function recommend(item:any){try{await window.dbxPlugin.request('host.ai.openConversation',{prompt:item.prompt,title:item.label});}catch(cause){error.value=String(cause);}}
async function importKey(event:Event, field:any){
  const input=event.target as HTMLInputElement;
  const file=input.files?.[0];
  input.value='';
  if(!file)return;
  const generation=editGeneration;
  importingKey.value=true;error.value='';
  try{
    if(file.size>1024*1024)throw new Error(t('Choose a private key file up to 1 MiB.'));
    const content=await file.text();
    if(generation!==editGeneration)return;
    if(!/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|^PuTTY-User-Key-File-\d+:/m.test(content))throw new Error(t('The selected file is not a supported private key.'));
    draft[field.picker.content_field]=content;
    draft[field.key]='';
    clearing[field.picker.content_field]=false;
    selectedKey.value=file.name;
  }catch(cause){if(generation===editGeneration)error.value=cause instanceof Error?cause.message:t('Could not read the private key. Choose the file again.');}
  finally{importingKey.value=false;}
}
onMounted(refresh);
</script>
<template>
  <div class="ssh-native-shell">
    <header class="ssh-native-bar"><button v-if="!manager" @click="manager=true"><ArrowLeft :size="15"/> {{t('Servers')}}</button><strong v-else>SSH</strong><span class="ssh-bar-title">{{ active ? bridgeState.title : t('Connections') }}</span><button v-if="active && manager" @click="manager=false"><Terminal :size="15"/> {{t('Return to session')}}</button><button v-if="active" :disabled="busy" @click="disconnect"><Unplug :size="15"/> {{t('Disconnect')}}</button></header>
    <div v-if="error || bridgeState.error" class="ssh-error" role="alert">{{ error || bridgeState.error }} <button :aria-label="t('Dismiss error')" @click="error='';bridgeState.error=''"><X :size="14"/></button></div>
    <main v-show="manager" class="ssh-manager">
      <section v-if="!editing" class="ssh-server-list">
        <div class="ssh-list-heading"><div><h1>{{t('Servers')}}</h1><p>{{t('Open a secure shell, transfer files, or manage a remote session.')}}</p></div><button class="ssh-primary" :disabled="loading" @click="edit()"><Plus :size="16"/> {{t('Add server')}}</button></div>
        <div class="ssh-list-tools"><label class="ssh-search"><Search :size="16"/><input v-model="search" type="search" :placeholder="t('Find a server')" :aria-label="t('Find a server')"/></label><button @click="refresh" :disabled="loading" :aria-label="t('Refresh servers')"><RefreshCw :size="16"/></button><button @click="local"><Terminal :size="16"/> {{t('Local terminal')}}</button></div>
        <p v-if="loading" role="status">{{t('Loading servers…')}}</p>
        <div v-else-if="!connections.length" class="ssh-empty"><Server :size="32"/><h2>{{t('Add your first server')}}</h2><p>{{t('Save its address and sign-in method to open the full SSH workbench.')}}</p><button class="ssh-primary" @click="edit()"><Plus :size="16"/> {{t('Add server')}}</button></div>
        <p v-else-if="!filtered.length">{{t('No servers match')}} “{{ search }}”。</p>
        <div v-else class="ssh-table-wrap"><table><thead><tr><th>{{t('Server')}}</th><th>{{t('Address')}}</th><th>{{t('Protocol')}}</th><th><span class="sr-only">{{t('Actions')}}</span></th></tr></thead><tbody><tr v-for="record in filtered" :key="record.id"><td><strong>{{record.name}}</strong><small>{{record.username}}</small></td><td class="mono">{{record.host}}<span v-if="record.port">:{{record.port}}</span></td><td>{{record.external_config?.protocol || 'ssh'}}</td><td class="ssh-row-actions"><button class="ssh-primary" :disabled="busy" @click="connect(record)"><PlugZap :size="15"/> {{t(bridgeState.context.connectionId===record.id?'Resume session':'Connect')}}</button><button :disabled="busy" @click="edit(record)" :aria-label="`${t('Edit server')} ${record.name}`"><Pencil :size="15"/></button><button :disabled="busy" @click="deleting=record" :aria-label="`${t('Delete server')} ${record.name}`"><Trash2 :size="15"/></button></td></tr></tbody></table></div>
      </section>
      <form v-else class="ssh-editor" @submit.prevent="save">
        <div class="ssh-editor-heading"><button type="button" @click="editing=false"><ArrowLeft :size="15"/> {{t('Servers')}}</button><h1>{{connections.some(row=>row.id===draft.id)?t('Edit server'):t('Add server')}}</h1></div>
        <div class="ssh-form-grid">
          <HarnessConnectionField v-for="field in basicFields" :key="field.key" :field="field" :draft="draft" :clearing="clearing" :selected-key="selectedKey" :importing="importingKey" @import-key="importKey($event,field)"/>
        </div>
        <details class="ssh-advanced"><summary>{{t('Advanced connection options')}}</summary>
          <div class="ssh-form-grid">
            <HarnessConnectionField v-for="field in otherFields" :key="field.key" :field="field" :draft="draft" :clearing="clearing"/>
          </div>
          <label class="ssh-field">{{t('Additional configuration (JSON)')}}<textarea v-model="advanced" rows="8" spellcheck="false" class="mono"/></label>
        </details>
        <footer><button type="button" :disabled="busy || importingKey" @click="editing=false">{{t('Cancel')}}</button><button class="ssh-primary" :disabled="busy || importingKey">{{busy?t('Saving…'):t('Save server')}}</button></footer>
      </form>
    </main>
    <section v-if="bridgeState.recommendations.length" class="ssh-ai-suggestions" :aria-label="t('AI suggestions')"><strong>{{t('AI suggestions')}}</strong><button v-for="item in bridgeState.recommendations" :key="item.id" @click="recommend(item)">{{item.label}}</button></section>
    <div v-if="active" v-show="!manager" class="ssh-upstream"><App :key="bridgeState.generation"/></div>
    <TunnelManager v-else-if="bridgeState.context.id" :context="bridgeState.context"/>
    <div v-if="deleting" class="ssh-native-overlay"><section class="ssh-native-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ssh-delete-title"><h2 id="ssh-delete-title">{{t('Delete server')}} {{deleting.name}}？</h2><p>{{t('This removes the saved connection and closes all active SSH plugin sessions.')}}</p><footer><button @click="deleting=null">{{t('Cancel')}}</button><button class="ssh-danger" :disabled="busy" @click="remove">{{t('Delete server')}}</button></footer></section></div>
    <div v-if="bridgeState.prompt" class="ssh-native-overlay"><form class="ssh-native-dialog" role="dialog" aria-modal="true" aria-labelledby="ssh-prompt-title" @submit.prevent="resolvePrompt('submit',promptValue)"><h2 id="ssh-prompt-title">{{bridgeState.prompt.title||t('Connection verification')}}</h2><p style="white-space:pre-wrap">{{bridgeState.prompt.prompt}}</p><select v-if="bridgeState.prompt.options?.length" v-model="promptValue" autofocus><option v-for="option in bridgeState.prompt.options" :value="typeof option==='string'?option:option.value">{{typeof option==='string'?option:option.label}}</option></select><input v-else v-model="promptValue" :type="bridgeState.prompt.echo?'text':'password'" autofocus autocomplete="off" :aria-label="t('Response')"/><footer><button type="button" @click="resolvePrompt('cancel')">{{t('Cancel')}}</button><button class="ssh-primary">{{t('Continue')}}</button></footer></form></div>
  </div>
</template>
