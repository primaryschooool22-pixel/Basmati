'use strict';
// Session and administrative records stay in memory; none are written to localStorage.
window.BasmatiAdmin=(()=>{
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const number=value=>new Intl.NumberFormat('ar-SA',{maximumFractionDigits:2}).format(Number(value)||0);
  const formatDate=value=>value?new Date(value).toLocaleString('ar-SA',{dateStyle:'short',timeStyle:'short'}):'—';
  const state={user:null,rows:[],stats:null,total:0,page:0,size:20,q:'',department:'',active:false,report:false,busy:false};
  let client=null,subscription=null,host=null,callbacks={},generation=0,idleTimer=null,refreshTimer=null;
  function el(id){return host?.querySelector('#'+id);}
  function ensureClient(){
    if(client)return client;
    const cfg=window.APP_CONFIG||{};let url;
    try{url=new URL(cfg.SUPABASE_URL);}catch{throw new Error('تعذّر الاتصال بالخدمة. راجعي مسؤولة المنصة.');}
    if(url.protocol!=='https:'||!cfg.SUPABASE_ANON_KEY||/^YOUR_|^sb_secret_/.test(cfg.SUPABASE_ANON_KEY))throw new Error('تعذّر الاتصال بالخدمة. راجعي مسؤولة المنصة.');
    if(!window.supabase?.createClient)throw new Error('تعذّر تحميل خدمة الدخول. حدّثي الصفحة.');
    client=window.supabase.createClient(url.origin,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'basmati-admin-memory'}});
    subscription=client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'&&state.user)setTimeout(()=>logout(),0);}).data.subscription;
    return client;
  }
  function touch(){if(!state.user)return;clearTimeout(idleTimer);idleTimer=setTimeout(()=>logout('انتهت الجلسة؛ سجّلي الدخول مرة أخرى.'),15*60*1000);}
  document.addEventListener('pointerdown',touch,{passive:true});document.addEventListener('keydown',touch);
  function setActive(active){state.active=active;if(!active){generation++;state.busy=false;state.report=false;state.rows=[];}}
  function clearPrivateState(){state.user=null;state.rows=[];state.stats=null;state.total=0;state.page=0;state.q='';state.department='';state.busy=false;state.report=false;generation++;clearTimeout(idleTimer);clearInterval(refreshTimer);}
  async function logout(message=''){
    const oldClient=client;subscription?.unsubscribe();subscription=null;client=null;clearPrivateState();
    callbacks.onLock?.();if(state.active&&host?.isConnected)loginView(message);
    if(oldClient){try{await oldClient.auth.signOut({scope:'local'});}catch{}finally{oldClient.auth.stopAutoRefresh();}}
  }
  function loginView(message=''){
    if(!host?.isConnected)return;
    host.innerHTML=`<section class="admin-login"><div class="admin-lock" aria-hidden="true">▣</div><h1>إدارة المدرسة</h1><p>الدخول المخصّص للاطلاع على جميع التقييمات وإحصائياتها وتقاريرها.</p><form id="admin-login-form"><div class="field"><label for="admin-email">البريد الإلكتروني</label><input id="admin-email" type="email" autocomplete="username" dir="ltr" required maxlength="254"></div><div class="field"><label for="admin-password">كلمة المرور</label><input id="admin-password" type="password" autocomplete="current-password" required maxlength="128"></div><p class="admin-error" id="admin-error" role="alert">${escape(message)}</p><button class="btn primary" id="admin-login-button" type="submit">دخول الإدارة</button></form></section>`;
    el('admin-login-form').onsubmit=async event=>{
      event.preventDefault();const ticket=++generation;
      const email=el('admin-email').value.trim(),password=el('admin-password').value;
      const btn=el('admin-login-button');btn.disabled=true;btn.textContent='جارٍ الدخول…';el('admin-error').textContent='';
      try{
        const sdk=ensureClient();
        const {data,error}=await sdk.auth.signInWithPassword({email,password});
        if(error)throw new Error('تعذّر الدخول. تحققي من البريد وكلمة المرور.');
        if(ticket!==generation||!state.active){await sdk.auth.signOut({scope:'local'});return;}
        const role=await sdk.from('basmati_admins').select('user_id').eq('user_id',data.user.id).maybeSingle();
        if(role.error||!role.data){await sdk.auth.signOut({scope:'local'});throw new Error('هذا الحساب غير مفعّل لإدارة المدرسة.');}
        if(ticket!==generation||!state.active)return;
        state.user={id:data.user.id,email:data.user.email};el('admin-password').value='';touch();
        clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(state.user&&state.active&&!state.report&&!state.busy&&document.visibilityState==='visible')refresh();},60000);
        await refresh();
      }catch(error){console.warn('Admin login unavailable',error.name);if(ticket===generation&&state.active){loginView(error.message||'تعذّر الدخول حاليًا. حاولي مجددًا.');}}
    };
  }
  function stat(label,value){return `<div class="admin-stat"><small>${escape(label)}</small><b>${number(value)}</b></div>`;}
  function chart(rows){const max=Math.max(1,...rows.map(x=>Number(x.count)||0));return rows.map(row=>`<div class="admin-chart"><span>${escape(row.label)}</span><div class="track"><div class="fill" style="width:${Math.max(0,Math.min(100,Number(row.count)/max*100))}%"></div></div><b>${number(row.count)}</b></div>`).join('')||'<p>لا توجد بيانات بعد.</p>';}
  function queryList(page=state.page){
    let query=ensureClient().from('basmati_evaluations').select('id,employee_name,job_title,department,school_name,submitted_at',{count:'exact'}).order('submitted_at',{ascending:false}).order('id',{ascending:true});
    if(state.q)query=query.ilike('employee_name','%'+state.q.replace(/[\\%_]/g,'\\$&')+'%');
    if(state.department)query=query.eq('department',state.department);
    return query.range(page*state.size,(page+1)*state.size-1);
  }
  function accessError(error){return error?.code==='42501'||error?.code==='PGRST301'||error?.status===401;}
  async function refresh(){
    if(!state.user||state.busy||!state.active)return;
    state.busy=true;const ticket=++generation;
    if(!state.stats)host.innerHTML='<section class="admin-message">جارٍ تحميل تقييمات المدرسة…</section>';
    else if(el('admin-refresh'))el('admin-refresh').disabled=true;
    try{
      const [stats,list]=await Promise.all([ensureClient().rpc('basmati_admin_statistics'),queryList()]);
      if(ticket!==generation||!state.active)return;
      if(stats.error||list.error){const error=stats.error||list.error;if(accessError(error)){await logout('انتهت صلاحية الجلسة أو الوصول.');return;}throw error;}
      state.stats=stats.data;state.rows=list.data||[];state.total=list.count||0;state.busy=false;panel();
    }catch(error){console.warn('Admin refresh unavailable',error.code||error.name);if(ticket===generation&&state.active){state.rows=[];state.stats=null;state.total=0;host.innerHTML='<section class="card"><p class="admin-error" role="alert">تعذّر تحميل التقييمات حاليًا. تحققي من الاتصال وتفعيل لوحة الإدارة.</p><button class="btn" id="admin-retry">إعادة المحاولة</button> <button class="btn" id="admin-exit">تسجيل الخروج</button></section>';el('admin-retry').onclick=()=>refresh();el('admin-exit').onclick=()=>logout();}}
    finally{if(ticket===generation)state.busy=false;if(el('admin-refresh'))el('admin-refresh').disabled=false;}
  }
  function panel(){
    if(!state.active||!state.user||!state.stats)return;
    const s=state.stats,departments=Array.isArray(s.departments)?s.departments:[],needs=Array.isArray(s.needs)?s.needs:[];
    host.innerHTML=`<section class="admin-panel"><div class="admin-toolbar"><div><div class="eyebrow">إدارة المدرسة</div><h1>التقييمات والإحصائيات</h1><p>جميع التقييمات المرسلة من جميع الأجهزة</p></div><div class="admin-actions"><button class="btn" id="admin-refresh">تحديث</button><button class="btn" id="admin-export">تصدير جميع البيانات</button><button class="btn" id="admin-print">طباعة الإحصائيات</button><button class="btn" id="admin-exit">تسجيل الخروج</button></div></div><div class="admin-status">${escape(state.user.email)} · آخر تحديث: ${escape(formatDate(s.refreshed_at))}</div><div class="admin-stats">${stat('إجمالي التقييمات',s.evaluations)}${stat('ساعات التطوع',s.volunteer_hours)}${stat('البرامج التدريبية المكتسبة',s.training_programs)}${stat('ساعات النمو المهني',s.growth_hours)}${stat('الاحتياجات المحددة',s.needs_count)}${stat('المساهمات في حل المشكلات',s.contributions)}${stat('المبادرات المعتمدة',s.initiatives)}${stat('البرامج والورش المقدمة',s.workshops)}</div><div class="admin-columns"><section class="card"><h2>التقييمات حسب الإدارة أو القسم</h2>${chart(departments.map(d=>({label:d.department,count:d.count})))}</section><section class="card"><h2>أكثر الاحتياجات تكرارًا</h2>${chart(needs.slice(0,8).map(n=>({label:callbacks.needLabel?.(n.id)||'احتياج '+n.id,count:n.count})))}</section></div><section class="card"><h2>سجل تقييمات الموظفات</h2><form class="admin-filter" id="admin-filter"><input id="admin-search" aria-label="البحث باسم الموظفة" placeholder="ابحثي باسم الموظفة…" value="${escape(state.q)}" maxlength="100"><select id="admin-department" aria-label="الإدارة أو القسم"><option value="">جميع الأقسام</option>${departments.map(d=>`<option value="${escape(d.department)}" ${state.department===d.department?'selected':''}>${escape(d.department)}</option>`).join('')}</select><button class="btn primary" type="submit">عرض النتائج</button></form><div class="tablewrap"><table class="admin-table"><thead><tr><th>الموظفة</th><th>المسمى الوظيفي</th><th>القسم</th><th>تاريخ الإرسال</th><th>التقرير والشواهد</th><th>الإجراءات</th></tr></thead><tbody>${state.rows.map(row=>`<tr><td>${escape(row.employee_name)}</td><td>${escape(row.job_title)}</td><td>${escape(row.department)}</td><td>${escape(formatDate(row.submitted_at))}</td><td><button class="btn" type="button" data-admin-report="${escape(row.id)}">عرض التقرير</button></td><td><button class="btn danger-btn" type="button" data-admin-delete="${escape(row.id)}" data-admin-name="${escape(row.employee_name)}">حذف</button></td></tr>`).join('')||'<tr><td colspan="6">لا توجد تقييمات مطابقة.</td></tr>'}</tbody></table></div><div class="admin-pagination"><button class="btn" id="admin-prev" ${state.page===0?'disabled':''}>السابق</button><span>الصفحة ${number(state.page+1)} · ${number(state.total)} نتيجة</span><button class="btn" id="admin-next" ${(state.page+1)*state.size>=state.total?'disabled':''}>التالي</button></div><p class="admin-progress" id="admin-progress" role="status"></p><p class="admin-error" id="admin-error" role="alert"></p></section></section>`;
    el('admin-refresh').onclick=()=>refresh();el('admin-exit').onclick=()=>logout();el('admin-print').onclick=()=>window.print();el('admin-export').onclick=exportAll;
    el('admin-filter').onsubmit=e=>{e.preventDefault();state.q=el('admin-search').value.trim();state.department=el('admin-department').value;state.page=0;refresh();};
    el('admin-prev').onclick=()=>{state.page=Math.max(0,state.page-1);refresh();};el('admin-next').onclick=()=>{state.page++;refresh();};
    host.querySelectorAll('[data-admin-report]').forEach(button=>button.onclick=()=>openReport(button.dataset.adminReport,button));
    host.querySelectorAll('[data-admin-delete]').forEach(button=>button.onclick=()=>deleteRecord(button.dataset.adminDelete,button.dataset.adminName,button));
  }
  async function deleteRecord(id,name,button){
    if(!state.user||state.busy)return;
    if(!confirm(`هل تريدين حذف تقييم ${name||'الموظفة'} نهائيًا؟\nسيُحذف السجل وشواهده من الإحصائيات ولا يمكن التراجع.`))return;
    state.busy=true;button.disabled=true;button.textContent='جارٍ الحذف…';const ticket=++generation;
    try{
      const response=await ensureClient().from('basmati_evaluations').delete().eq('id',id);
      if(ticket!==generation||!state.active)return;
      if(response.error){if(accessError(response.error)){await logout();return;}throw response.error;}
      state.busy=false;
      if(state.page>0&&state.rows.length===1)state.page--;
      await refresh();
    }catch(error){console.warn('Admin delete unavailable',error.code||error.name);if(el('admin-error'))el('admin-error').textContent='تعذّر حذف السجل. تحققي من تفعيل صلاحية الحذف ثم حاولي مجددًا.';}
    finally{if(ticket===generation)state.busy=false;if(button.isConnected){button.disabled=false;button.textContent='حذف';}}
  }
  async function openReport(id,button){
    if(!state.user||state.busy)return;state.busy=true;button.disabled=true;const ticket=++generation;
    try{
      const response=await ensureClient().from('basmati_evaluations').select('*').eq('id',id).maybeSingle();
      if(ticket!==generation||!state.active)return;
      if(response.error){if(accessError(response.error)){await logout();return;}throw response.error;}
      if(!response.data)throw new Error('No authorized record');
      const row=response.data,raw=row.data||{},record={...raw,id:row.id,name:row.employee_name,job:row.job_title,department:row.department,date:row.submitted_at,tech:Array.isArray(raw.tech)?raw.tech:[],developCompetencies:Array.isArray(raw.developCompetencies)?raw.developCompetencies:[],courses:Array.isArray(raw.courses)?raw.courses:[],period:{...(raw.period||{}),school:row.school_name}};
      state.report=true;callbacks.openReport?.(record);
    }catch(error){console.warn('Report unavailable',error.code||error.name);if(el('admin-error'))el('admin-error').textContent='تعذّر فتح التقرير. حدّثي السجل وحاولي مجددًا.';}
    finally{if(ticket===generation)state.busy=false;if(button.isConnected)button.disabled=false;}
  }
  async function exportAll(){
    if(!state.user||state.busy||!state.stats)return;
    const ticket=++generation;state.busy=true;const button=el('admin-export');button.disabled=true;
    const snapshot=state.stats.snapshot_at;const rows=[];
    try{
      if(snapshot){for(let offset=0;;offset+=200){
        const response=await ensureClient().from('basmati_evaluations').select('*').lte('submitted_at',snapshot).order('submitted_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+199);
        if(ticket!==generation||!state.user||!state.active)return;
        if(response.error)throw response.error;rows.push(...(response.data||[]));
        if(el('admin-progress'))el('admin-progress').textContent='جارٍ تجهيز '+number(rows.length)+' تقييم…';
        if((response.data||[]).length<200)break;
      }}
      const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),statistics:state.stats,evaluations:rows},null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='basmati-school-evaluations-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      if(el('admin-progress'))el('admin-progress').textContent='';
    }catch(error){console.warn('Export unavailable',error.code||error.name);if(el('admin-error'))el('admin-error').textContent='لم يكتمل التصدير. لم يتم تنزيل ملف ناقص؛ أعيدي المحاولة.';}
    finally{rows.length=0;state.busy=false;if(button.isConnected)button.disabled=false;}
  }
  function mount(options){host=options.host;callbacks=options;state.active=true;state.report=false;if(state.user){touch();refresh();}else loginView();}
  return {mount,setActive,logout};
})();
