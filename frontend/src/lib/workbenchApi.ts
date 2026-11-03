import { inject, type InjectionKey } from 'vue';

export interface WorkbenchScope {
  api: DbxPluginApi;
  rootId: string;
  active: () => boolean;
}

export const workbenchScopeKey: InjectionKey<WorkbenchScope> = Symbol('ssh-workbench');
export function useWorkbenchApi(): DbxPluginApi {
  return inject(workbenchScopeKey, null)?.api ?? window.dbxPlugin;
}
export function useWorkbenchPortal(): string {
  const scope = inject(workbenchScopeKey, null);
  return scope ? `#${scope.rootId}` : document.getElementById('dsh-ssh-root') ? '#dsh-ssh-root' : 'body';
}
