import { createApp } from 'vue';
import { installBridge, bridgeState, closeWorkbench, updateContext } from './harnessBridge';
import { themeBridgeCss } from '../shared/frontend/themeSync';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './styles/tailwind.css';
import './harness.css';
declare const require: (id: string) => any;
declare const __DSH_SSH_CSS__: string;
export default {
  inject: ['slots', 'connection', 'locale'],
  apply(ctx: any) {
    const React = require('react');
    // Harness unmounts pages on sidebar navigation. The plugin owns the Vue
    // workbench so leaving SSH only detaches its surface; explicit disconnect
    // and plugin disposal still release its PTYs and bridge resources.
    const surface = document.createElement('div');
    const parking = document.createElement('div');
    parking.hidden = true;
    parking.dataset.sshParking = '';
    document.body.append(parking);
    surface.id = 'dsh-ssh-root';
    Object.assign(surface.style,{height:'100%',width:'100%',minHeight:'0',minWidth:'0',position:'relative',contain:'layout style',isolation:'isolate',overflow:'hidden'});
    const style = document.createElement('style');
    // The upstream entry installs this bridge before mounting. Harness uses a
    // different entry, so include it here too. Its generated selectors all use
    // :root; bind them to this surface instead of changing the host document.
    style.textContent = __DSH_SSH_CSS__ + '\n' + themeBridgeCss().replaceAll(':root', '#dsh-ssh-root');
    const vueMount = document.createElement('div');
    vueMount.className = 'ssh-vue-mount';vueMount.style.height='100%';
    surface.append(style,vueMount);
    let disposed = false;let app: ReturnType<typeof createApp> | undefined;
    let disposeBridge: (()=>Promise<void>) | undefined;
    let booting: Promise<void> | undefined;
    function boot() {
      return booting ||= (async()=>{
        disposeBridge = installBridge(ctx,surface);
        const {default:HarnessApp} = await import('./HarnessApp.vue');
        if(disposed)return;
        app=createApp(HarnessApp);
        app.config.errorHandler=(error:any)=>{bridgeState.error=String(error);};
        app.mount(vueMount);
      })();
    }
    ctx.effect(()=>async()=>{disposed=true;
      await booting?.catch(()=>undefined);
      await closeWorkbench();app?.unmount();await disposeBridge?.();
      updateContext({});surface.remove();parking.remove();
    });
    function SshPage() {
      const mount = React.useRef(null);
      const [failure, setFailure] = React.useState('');
      React.useEffect(() => {
        const container=mount.current;let cancelled=false;
        container.append(surface);
        void boot().catch(error=>{if(!cancelled)setFailure(String(error));});
        return () => {cancelled=true;if(surface.parentNode===container && !disposed)parking.append(surface);};
      }, []);
      return React.createElement('div', { ref:mount, style:{height:'100%',minHeight:0,minWidth:0} }, failure ? React.createElement('div',{role:'alert'},failure) : null);
    }
    const label = () => ctx.locale?.text?.('ssh.title') || 'SSH';
    ctx.slots.inject('main', () => ctx.slots.register({name:'main',key:'ssh'},SshPage));
    function SSHIcon({size=18}:any) {return React.createElement('svg',{viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},React.createElement('path',{d:'m5 7 5 5-5 5M13 17h6'}));}
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name:'sidebar.panellist',id:'ssh',order:50,label},SSHIcon));
  },
};
