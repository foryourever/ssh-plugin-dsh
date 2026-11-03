import { createApp } from 'vue';
import { installBridge, bridgeState, closeWorkbench } from './harnessBridge';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './styles/tailwind.css';
import './harness.css';
declare const require: (id: string) => any;
export default {
  inject: ['slots', 'connection', 'locale'],
  apply(ctx: any) {
    const React = require('react');
    function SshPage() {
      const mount = React.useRef(null);
      const [failure, setFailure] = React.useState('');
      React.useEffect(() => {
        let cancelled = false; let app: any; const dispose = installBridge(ctx, mount.current);
        const boot = async () => { try { const [{default: HarnessApp}] = await Promise.all([import('./HarnessApp.vue')]); if(cancelled)return; app=createApp(HarnessApp); app.config.errorHandler=(error:any)=>{bridgeState.error=String(error);}; app.mount(mount.current.querySelector('.ssh-vue-mount')); } catch(error) { if(!cancelled)setFailure(String(error)); } };
        void boot();
        return () => { cancelled=true; void closeWorkbench(); app?.unmount(); void dispose(); };
      }, []);
      return React.createElement('div', { id:'dsh-ssh-root', ref:mount, style:{height:'100%',width:'100%',minHeight:0,minWidth:0,position:'relative',contain:'layout style',isolation:'isolate',overflow:'hidden'} }, React.createElement('style', null, '__DSH_SSH_CSS__'), failure ? React.createElement('div',{role:'alert'},failure) : null, React.createElement('div',{className:'ssh-vue-mount',style:{height:'100%'}}));
    }
    const label = () => ctx.locale?.text?.('ssh.title') || 'SSH';
    ctx.slots.inject('main', () => ctx.slots.register({name:'main',key:'ssh'},SshPage));
    function SSHIcon({size=18}:any) {return React.createElement('svg',{viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor',strokeWidth:1.7,'aria-hidden':true},React.createElement('path',{d:'m5 7 5 5-5 5M13 17h6'}));}
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({name:'sidebar.panellist',id:'ssh',order:50,label},SSHIcon));
  },
};
