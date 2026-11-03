const zh: Record<string,string> = {
  'New session':'新建会话','Open sessions':'已打开的会话','Close session':'关闭会话','Connect another server':'连接其他服务器',
  'SSH server':'SSH 服务器','Resume session':'返回会话','Choose file…':'选择文件…','Importing…':'正在导入…','Key imported':'已导入私钥',
  'Choose a private key file up to 1 MiB.':'请选择不超过 1 MiB 的私钥文件。',
  'The selected file is not a supported private key.':'所选文件不是支持的私钥，请选择 OpenSSH、PEM 或 PPK 私钥文件。',
  'Could not read the private key. Choose the file again.':'无法读取私钥文件，请重新选择。',
  'Enter a key path on the Harness machine, or choose a file to import its contents below. Provide a path or key content.':'可直接输入 Harness 所在机器上的密钥路径，或选择文件将内容导入下方「私钥内容」。至少填写路径或内容其中一项。',
  'Paste or import an OpenSSH, PEM or PPK private key. Saved keys are stored as credentials and never shown again; content takes precedence over the path.':'粘贴或从文件导入 OpenSSH、PEM、PPK 私钥。保存后存入凭据库，不再回显；内容非空时优先于路径。',
  'Advanced configuration must be a JSON object.':'附加配置必须是 JSON 对象，请检查格式。',

  'Servers':'服务器','Connections':'连接','Return to session':'返回会话','Disconnect':'断开连接','Open a secure shell, transfer files, or manage a remote session.':'打开安全终端、传输文件或管理远程会话。','Add server':'添加服务器','Find a server':'搜索服务器','Refresh servers':'刷新服务器','Local terminal':'本地终端','Loading servers…':'正在加载服务器…','Add your first server':'添加第一台服务器','Save its address and sign-in method to open the full SSH workbench.':'保存服务器地址与登录方式，打开完整的 SSH 工作台。','Server':'服务器','Address':'地址','Protocol':'协议','Actions':'操作','Connect':'连接','Edit server':'编辑服务器','Advanced connection options':'高级连接选项','Additional configuration (JSON)':'附加配置（JSON）','Cancel':'取消','Saving…':'正在保存…','Save server':'保存服务器','Leave blank to keep the saved value.':'留空保留已保存的凭据。','Clear saved value':'清除已保存的值','This removes the saved connection and closes all active SSH plugin sessions.':'此操作会删除已保存的连接，并关闭 SSH 插件的所有活动会话。','Delete server':'删除服务器','Continue':'继续','Connection verification':'连接验证','Response':'回答','Dismiss error':'关闭错误提示','AI suggestions':'AI 建议','Delete':'删除','No servers match':'没有匹配的服务器','Connection name':'连接名称','Host':'主机','Port':'端口','Username':'用户名','Authentication':'认证方式','Password':'密码','Password source':'密码来源','Private key content':'私钥内容','Private key path':'私钥路径','Private key passphrase':'私钥口令',
};
export function translate(text:string, locale = document.documentElement.lang || navigator.language) { return locale.toLowerCase().startsWith('zh') ? zh[text] || text : text; }

// The manifest owns field translations, including option labels. Keep wire
// values, bindings and visibility conditions intact when applying its copy.
export function connectionFields(manifest: any, locale = document.documentElement.lang || navigator.language) {
  const provider = manifest.contributions.find((row: any) => row.type === 'connection-provider');
  const normalized = locale.toLowerCase();
  const locales = Object.keys(manifest.localizations || {});
  const key = locales.find(key => key.toLowerCase() === normalized)
    || (normalized.startsWith('zh') ? (/(tw|hk|hant)/.test(normalized) ? 'zh-TW' : 'zh-CN') : locales.find(key => key.toLowerCase() === normalized.split('-')[0]));
  const translations = manifest.localizations?.[key || 'en']?.contributions?.[provider.id]?.fields || {};
  return provider.fields.map((field: any) => {
    const { options, ...copy } = translations[field.key] || {};
    return { ...field, ...copy, options: field.options?.map((option: any) => ({ ...option, label: options?.[option.value] || option.label })) };
  });
}
