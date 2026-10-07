/* global console, process, setTimeout, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
// Use an existing Playwright installation; this check does not install dependencies.
const { chromium } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : 'playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(repo, 'frontend/dist');
const output = path.join(repo, '.cache/monthly-keyboard');
fs.mkdirSync(output, { recursive: true });
const fields = ['wolo10','bdpocdiscipline','wonum','description','worktype','location','systemid','schedstart','schedfinish','actstart','actfinish','status','wopriority_description','lead','assignedtechname','estdur','targstartdate','targcompdate','workorderid'];
const rows = Array.from({length:200}, (_,i) => ({...Object.fromEntries(fields.map(k=>[k,null])), siteid: i%2?'SITE-B':'SITE-A', workorderid:String(1000+i), wonum:`MONTH-${i+1}`, bdpocdiscipline:'MECH', status:'APPR', worktype:i%10===0?'PM':'CM', description:`Synthetic monthly task ${i+1}`, estdur:'8', assignedtechname:'TECH', targcompdate:'2026-10-31T00:00:00+07:00', wopriority:0}));
const detail = item => ({item, baseline:{worktype:item.worktype,schedstart:null,schedfinish:null,estdur:'8',assignedtechname:'TECH',targstartdate:null,targcompdate:item.targcompdate},baseline_token:'a'.repeat(64),allowed_pics:['TECH','OTHER'],pics_configured:true});
const session = {user:{id:'synthetic-user',name:'Synthetic planner',is_admin:false},preferred_connection_id:'one',grants:['one','two'].map((id,i)=>({connection_id:id,label:`Synthetic ${id}`,system:i?'offshore':'onshore',environment:'test',timezone:'Asia/Ho_Chi_Minh',discipline:'MECH',capability:'write'}))};
let count=200, chooser=false, saved=null, saveBody=null, accept=true, requests=0;
const errors=[], timings=[];
const server = http.createServer((req,res) => {
  const requested = path.resolve(dist, '.' + new URL(req.url,'http://localhost').pathname);
  if (!requested.startsWith(dist + path.sep) && requested!==dist) {res.writeHead(403);res.end();return;}
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile()?requested:path.join(dist,'index.html');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
});
async function waitFor(fn, message) { for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw new Error(message); }
async function run() {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const context=await browser.newContext({viewport:{width:1600,height:1000}});
    await context.addInitScript(()=>{document.cookie='__Host-wos-csrf=synthetic-token; Secure; Path=/';});
    const page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>accept?d.accept():d.dismiss());
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin){errors.push(`Unexpected external request: ${url.origin}`);return route.abort();}
      if(!url.pathname.startsWith('/api/'))return route.continue();
      requests++;
      let body,status=200;
      const method=route.request().method(), p=url.pathname;
      if(p==='/api/health/live')body={status:'ok'};
      else if(p==='/api/auth/configuration')body={login_available:true};
      else if(p==='/api/auth/session')body=session;
      else if(p==='/api/settings/connection'){
        if(method==='PUT'){session.preferred_connection_id=route.request().postDataJSON().connection_id;status=204;}
        else body={...session,connections:session.grants.map(g=>({connection_id:g.connection_id,url:`https://${g.connection_id}.invalid/maximo`}))};
      } else if(p==='/api/work-orders/detail')body={connection_id:'one',...detail(rows.find(r=>r.workorderid===url.searchParams.get('workorder_id')))};
      else if(p==='/api/work-orders')body={connection_id:'one',discipline:'MECH',count,items:rows.slice(0,count).map((row,i)=>({...row,drafts:chooser&&i===0?['plan-a','plan-b'].map(id=>({draft_id:id,version:1,is_batch:false,updated_at:'2026-10-07T08:00:00+07:00',baseline_changed:false,changes:{estdur:'9'}})):saved?saved.items.filter(x=>x.workorder_id===row.workorderid).map(x=>({draft_id:'monthly',version:1,is_batch:true,updated_at:'2026-10-07T08:00:00+07:00',baseline_changed:false,changes:x.changes})):[]}))};
      else if(p==='/api/draft-batches/prepare'){const data=route.request().postDataJSON();body={connection_id:'one',discipline:'MECH',items:data.items.map(x=>detail(rows.find(r=>r.workorderid===x.workorder_id)))};}
      else if(p==='/api/draft-batches' && method==='POST'){
        saveBody=route.request().postDataJSON();saved={draft_id:'monthly',connection_id:'one',state:'draft',version:1,updated_at:'2026-10-07T08:00:00+07:00',items:saveBody.items.map(x=>({...detail(rows.find(r=>r.workorderid===x.workorder_id)),...x,discipline:'MECH',baseline_changed:false,changes_valid_now:true}))};body=saved;status=201;
      } else if(p==='/api/draft-batches/monthly')body=saved;
      else if(p.startsWith('/api/drafts/'))body={draft_id:p.split('/').at(-1),connection_id:'one',version:1,state:'draft',items:[{...detail(rows[0]),site_id:rows[0].siteid,workorder_id:rows[0].workorderid,discipline:'MECH',baseline_changed:false,changes_valid_now:true,changes:{estdur:'9'}}]};
      else {errors.push(`Unexpected API: ${method} ${p}`);status=500;body={};}
      await route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body)});
    });
    async function press(locator,key='Enter'){await locator.focus();await page.keyboard.press(key);}
    async function focused(locator){return locator.evaluate(el=>document.activeElement===el);}
    async function retrieve(){await page.goto(origin+'/work-orders');await page.getByRole('button',{name:'Retrieve WO',exact:true}).waitFor();await page.getByLabel('Target Finish từ', {exact:true}).fill('2026-10-01');await page.getByLabel('Target Finish trước',{exact:true}).fill('2026-11-01');await press(page.getByRole('button',{name:'Retrieve WO',exact:true}));await page.getByRole('button',{name:`MONTH-${count}`,exact:true}).waitFor();}
    for(count of [100,200]){
      console.log(`Checking ${count} WO`);saved=null;saveBody=null;await retrieve();
      const opener=page.getByRole('button',{name:'MONTH-1',exact:true});await press(opener);
      let panel=page.getByRole('dialog',{name:'Chỉnh sửa nháp',exact:true});
      await panel.getByLabel('Est. Duration',{exact:true}).waitFor();await waitFor(()=>focused(panel),'Single panel initial focus');
      await page.keyboard.press('Tab');assert(await focused(panel.getByRole('button',{name:'Đóng nháp',exact:true})));
      await page.keyboard.press('Shift+Tab');assert(await focused(panel.getByRole('button',{name:'Reset về baseline',exact:true})));
      await page.keyboard.press('Tab');assert(await focused(panel.getByRole('button',{name:'Đóng nháp',exact:true})));
      await press(panel.getByLabel('Est. Duration',{exact:true}),'ControlOrMeta+A');await page.keyboard.insertText('9');
      accept=false;await page.keyboard.press('Escape');assert(await panel.isVisible());assert.equal(await panel.getByLabel('Est. Duration',{exact:true}).inputValue(),'9');
      accept=true;await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert(await focused(opener));
      await press(page.getByRole('checkbox',{name:`Chọn tất cả ${count} WO trong kết quả lọc đã tải`,exact:true}),'Space');
      const batchOpener=page.getByRole('button',{name:`Lập lịch nhóm (${count})`,exact:true});const begin=performance.now();await press(batchOpener);
      panel=page.getByRole('dialog',{name:'Lập lịch hàng loạt',exact:true});await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).waitFor();
      await waitFor(()=>focused(panel),'Batch initial focus');const opened=performance.now()-begin;
      await page.keyboard.press('Tab');assert(await focused(panel.getByRole('button',{name:'Đóng nhóm',exact:true})));
      await page.keyboard.press('Shift+Tab');assert(await focused(panel.locator('summary')));await page.keyboard.press('Enter');
      await page.keyboard.press('Tab');assert(await focused(panel.getByLabel('Vùng dữ liệu Excel')));
      const pasted=Array.from({length:count},(_,i)=>`2026-10-09T08:00\tOTHER\t${i===count-1?'2.25':'9.5'}`).join('\r\n');await page.keyboard.insertText(pasted);
      await page.keyboard.press('Tab');assert(await focused(panel.getByRole('button',{name:'Kiểm tra và áp dữ liệu dán',exact:true})));
      const applyBegin=performance.now();await page.keyboard.press('Enter');await waitFor(async()=>await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).inputValue()==='2.25','Apply last row');const applied=performance.now()-applyBegin;
      assert.equal(await panel.getByLabel('MONTH-1 Scheduled Finish',{exact:true}).inputValue(),'09/10/2026, 17:30');
      await page.keyboard.press('Tab');assert(await focused(panel.getByRole('button',{name:'Đóng nhóm',exact:true})));
      await press(panel.getByRole('button',{name:'Undo',exact:true}));assert.equal(await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).inputValue(),'8');
      await press(panel.getByLabel('Vùng dữ liệu Excel'),'ControlOrMeta+A');await page.keyboard.insertText(pasted);await page.keyboard.press('Tab');await page.keyboard.press('Enter');
      await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();
      await press(page.getByRole('radio').first(),'Space');await page.keyboard.press('Tab');assert(await focused(page.getByRole('radio').first())===false);
      await press(page.getByRole('link',{name:'← Work Orders',exact:true}));await waitFor(()=>focused(panel),'Retained batch re-entry');assert.equal(await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).inputValue(),'2.25');
      const previewBegin=performance.now();await press(panel.getByRole('button',{name:'Xem trước thay đổi',exact:true}));await panel.getByRole('region',{name:'Preview nhóm'}).waitFor();assert.equal(await panel.getByRole('region',{name:'Preview nhóm'}).getByRole('row').count(),count*4+1);const previewed=performance.now()-previewBegin;
      const saveBegin=performance.now();await press(panel.getByRole('button',{name:'Lưu nháp nhóm',exact:true}));await panel.getByText(`Đã lưu nháp ${count} WO · v1. Maximo chưa thay đổi.`,{exact:true}).waitFor();const savedMs=performance.now()-saveBegin;
      assert.equal(saveBody.items.length,count);assert.equal(saveBody.items.at(-1).changes.estdur,'2.25');
      if(count===200)await page.screenshot({path:path.join(output,'200-preview.png')});
      await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert(await focused(batchOpener));
      await press(opener);await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).waitFor();assert.equal(await panel.getByLabel(`MONTH-${count} Est. Duration`,{exact:true}).inputValue(),'2.25');await page.keyboard.press('Escape');assert(await focused(opener));
      timings.push({count,open_ms:Math.round(opened),paste_apply_ms:Math.round(applied),preview_ms:Math.round(previewed),mock_save_ms:Math.round(savedMs)});
    }
    count=2;chooser=true;saved=null;await retrieve();const opener=page.getByRole('button',{name:'MONTH-1',exact:true});await press(opener);
    const choosing=page.getByRole('dialog',{name:'Chọn nháp của WO',exact:true});await waitFor(()=>focused(choosing),'Chooser initial focus');
    await page.keyboard.press('Shift+Tab');assert(await focused(choosing.getByRole('button',{name:'Xem Maximo / tạo nháp mới',exact:true})));
    await page.keyboard.press('Tab');assert(await focused(choosing.getByRole('button',{name:'Đóng',exact:true})));await page.keyboard.press('Tab');await page.keyboard.press('Enter');
    const single=page.getByRole('dialog',{name:'Chỉnh sửa nháp',exact:true});await single.getByLabel('Est. Duration',{exact:true}).waitFor();await waitFor(()=>focused(single),'Chooser-to-editor focus');assert.equal(await single.getByLabel('Est. Duration',{exact:true}).inputValue(),'9');await page.keyboard.press('Escape');assert(await focused(opener));
    await press(opener);await choosing.waitFor();const otherOpener=page.getByRole('button',{name:'MONTH-2',exact:true});await press(otherOpener);await single.getByLabel('Est. Duration',{exact:true}).waitFor();await waitFor(()=>focused(single),'Background WO replacement');await page.keyboard.press('Escape');assert(await focused(otherOpener));
    await press(page.getByRole('link',{name:'Settings',exact:true}));const radio=page.getByRole('radio').first();await radio.waitFor();await press(radio,'ArrowDown');assert(await page.getByRole('radio').nth(1).isChecked());await page.keyboard.press('Tab');assert(await focused(page.getByRole('button',{name:'Lưu hệ thống',exact:true})));await page.keyboard.press('Enter');await page.getByText('Đã lưu hệ thống cho tài khoản.',{exact:false}).waitFor();assert.equal(session.preferred_connection_id,'two');
    assert.deepEqual(errors,[]);const evidence={date:'2026-10-07',browser:browser.version(),viewport:'1600x1000',timings,requests,errors,checks:['single Tab/Shift+Tab boundaries','Escape dirty dismiss/accept and opener return','batch Space select-all/Enter open','details Enter/Tab paste/Undo/preview/save/reopen','Settings route retained edits/released focus','chooser Tab/Shift+Tab/Enter transition and opener return','Settings radio ArrowDown/Tab/Enter save'],limits:'Synthetic APIs only; Chromium local timings include automation overhead, no live Maximo writes or production performance claim'};fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  } finally {await browser.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());

