const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function request(url,opt){const r=await fetch(url,opt),j=await r.json();if(!r.ok)throw Error(j.error||'Request failed');return j;}
async function refresh(){try{const j=await request('/api/demo/events');$('log').innerHTML=j.events.slice().reverse().map(x=>`<div>• ${esc(x)}</div>`).join('');$('error').textContent='';}catch(e){$('error').textContent=e.message;}}
$('refresh').onclick=refresh;$('reset').onclick=async()=>{if(!confirm('Reset all fictional slots and offers?'))return;try{await request('/api/demo/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();}catch(e){$('error').textContent=e.message;}};refresh();
