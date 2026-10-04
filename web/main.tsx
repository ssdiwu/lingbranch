import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Atlas from './app/atlas';
import './app/globals.css';

function App() {
  const [state,setState] = useState<'loading'|'login'|'ready'|'error'>('loading');
  const [token,setToken] = useState(''), [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const check = async() => {
    try { const response = await fetch('/api/session'); if (!response.ok) throw new Error('服务无法连接。'); const result = await response.json(); setState(result.authenticated ? 'ready' : 'login'); }
    catch(reason) { setError(reason instanceof Error ? reason.message : '服务无法连接。'); setState('error'); }
  };
  useEffect(() => { void check(); },[]);
  if (state === 'ready') return <Atlas/>;
  if (state === 'loading') return <main className="atlas-access" role="status">正在打开灵枝…</main>;
  if (state === 'error') return <main className="atlas-access"><h1>暂时无法连接</h1><p role="alert">{error}</p><button onClick={() => void check()}>重试</button></main>;
  return <main className="atlas-access"><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json','X-LingBranch-Request':'1'},body:JSON.stringify({token})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setToken(''); setState('ready');
    } catch(reason) { setError(reason instanceof Error ? reason.message : '登录失败，请重试。'); } finally { setBusy(false); }
  }}><h1>LingBranch · 灵枝</h1><p>输入部署者配置的访问令牌，打开这份个人资料库。</p><label>访问令牌<input type="password" autoComplete="current-password" value={token} onChange={event => setToken(event.target.value)} required/></label>{error && <p role="alert">{error}</p>}<button disabled={busy || !token}>{busy ? '正在验证…' : '打开资料库'}</button></form></main>;
}

createRoot(document.getElementById('root')!).render(<App/>);
