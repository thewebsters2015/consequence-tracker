import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://qdkisfsbanlbgegnoben.supabase.co";
let SUPABASE_ANON_KEY = "";

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.text(); throw new Error(err); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const DEFAULT_KIDS = ["Zariah", "Serenity"];
const COLORS = ["#f97316", "#8b5cf6"];
const LIGHT_COLORS = ["#fff7ed", "#f5f3ff"];
const BORDER_COLORS = ["#fed7aa", "#ddd6fe"];

const PRESET_CATEGORIES = [
  { category: "Screen & Tech", icon: "📱", items: ["No screen time (TV, tablets, phones)","No video games","No social media","No YouTube or streaming","Limited to 30 min screen time per day"] },
  { category: "Social & Activities", icon: "🏃", items: ["No playdates or friends over","No park or playground","No extracurricular activities","No sleepovers","No birthday parties or outings"] },
  { category: "Privileges", icon: "⭐", items: ["No dessert or sweets","No allowance this week","Early bedtime (1 hour earlier)","No staying up late on weekends","No special outings or treats"] },
  { category: "Responsibilities", icon: "🧹", items: ["Extra chores added","Must complete all chores before any free time","No toys in common areas","Room must be clean before leaving the house"] },
  { category: "School & Learning", icon: "📚", items: ["Homework must be done immediately after school","Reading 30 min before any screen time","No friends home until grades improve"] },
];

const DURATION_OPTIONS = [
  { label:"1 day", days:1 },{ label:"2 days", days:2 },{ label:"3 days", days:3 },{ label:"5 days", days:5 },
  { label:"1 week", days:7 },{ label:"2 weeks", days:14 },{ label:"3 weeks", days:21 },{ label:"30 days", days:30 },
];

const SETUP_SQL = `create table if not exists consequences (
  id bigint generated always as identity primary key,
  kid_idx int not null, description text not null, start_date text not null,
  end_date text, note text, lifted_early boolean default false,
  added_by text, created_at timestamptz default now()
);
create table if not exists consequence_comments (
  id bigint generated always as identity primary key,
  consequence_id bigint references consequences(id) on delete cascade,
  author text not null, body text not null, created_at timestamptz default now()
);
create table if not exists behavior_journal (
  id bigint generated always as identity primary key,
  kid_idx int not null, entry text not null,
  added_by text, created_at timestamptz default now()
);
alter table consequences enable row level security;
alter table consequence_comments enable row level security;
alter table behavior_journal enable row level security;
create policy "allow all" on consequences for all using (true) with check (true);
create policy "allow all" on consequence_comments for all using (true) with check (true);
create policy "allow all" on behavior_journal for all using (true) with check (true);`;

// ── Helpers ───────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().split("T")[0]; }
function addDays(dateStr, days) { const d = new Date(dateStr+"T12:00:00"); d.setDate(d.getDate()+days); return d.toISOString().split("T")[0]; }
function formatDate(iso) { if (!iso) return "—"; return new Date(iso+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); }
function formatDateTime(iso) { if (!iso) return ""; return new Date(iso).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}); }
function daysLeft(endDate) { if (!endDate) return null; const now=new Date();now.setHours(0,0,0,0);const end=new Date(endDate);end.setHours(0,0,0,0);return Math.ceil((end-now)/86400000); }
function isActive(c) { if (c.lifted_early) return false; if (!c.end_date) return true; return daysLeft(c.end_date)>=0; }
function badge(color,bg) { return {display:"inline-block",padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,letterSpacing:"0.04em",color,background:bg,border:`1px solid ${color}22`}; }
function StatusBadge({c}) {
  if (c.lifted_early) return <span style={badge("#6b7280","#f3f4f6")}>Lifted Early</span>;
  if (!c.end_date) return <span style={badge("#2563eb","#eff6ff")}>Ongoing</span>;
  const left = daysLeft(c.end_date);
  if (left<0) return <span style={badge("#6b7280","#f3f4f6")}>Expired</span>;
  if (left===0) return <span style={badge("#dc2626","#fef2f2")}>Ends Today</span>;
  if (left<=2) return <span style={badge("#dc2626","#fef2f2")}>{left}d left</span>;
  return <span style={badge("#16a34a","#f0fdf4")}>{left}d left</span>;
}
function smallBtn(color) { return {padding:"5px 12px",background:"white",border:`1px solid ${color}`,borderRadius:6,color,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600}; }
function inputSt() { return {width:"100%",boxSizing:"border-box",padding:"8px 10px",border:"1px solid #e7e5e4",borderRadius:8,fontFamily:"inherit",fontSize:14,outline:"none",background:"#fafaf9"}; }
function getOverlappingActive(consequences, kidIdx, startDate, endDate) {
  return consequences.filter(c => {
    if (c.kid_idx!==kidIdx) return false;
    if (!isActive(c)) return false;
    const exStart=c.start_date, exEnd=c.end_date;
    if (endDate&&exStart&&endDate<exStart) return false;
    if (exEnd&&startDate&&exEnd<startDate) return false;
    return true;
  });
}

// ── Gear Button (reusable) ────────────────────────────────────────
function GearBtn({ onOpen }) {
  return (
    <button
      onClick={onOpen}
      title="Settings"
      style={{background:"#292524",border:"none",borderRadius:8,padding:"5px 9px",fontSize:18,cursor:"pointer",lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}
    >⚙️</button>
  );
}

// ── Settings Modal ────────────────────────────────────────────────
function SettingsModal({ useSupabase, currentParent, onSaveKey, onSwitchParent, onClose }) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  function save() {
    if (!apiKey.trim()) return;
    onSaveKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  function copy() {
    navigator.clipboard.writeText(SETUP_SQL).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:100,display:"flex",alignItems:"flex-end"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxHeight:"90vh",overflowY:"auto",paddingBottom:40}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 0"}}>
          <div style={{width:36,height:4,borderRadius:2,background:"#e7e5e4"}}/>
        </div>
        <div style={{padding:"12px 20px 14px",borderBottom:"1px solid #f5f5f4",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h2 style={{margin:0,fontSize:18,fontWeight:700,color:"#1c1917"}}>⚙️ Settings</h2>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#a8a29e",lineHeight:1}}>×</button>
        </div>

        <div style={{padding:"16px"}}>
          {/* Connection status */}
          <div style={{background:useSupabase?"#f0fdf4":"#fff7ed",border:`1px solid ${useSupabase?"#bbf7d0":"#fed7aa"}`,borderRadius:12,padding:"12px 14px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:22}}>{useSupabase?"🟢":"🟡"}</span>
            <div>
              <p style={{margin:0,fontSize:13,fontWeight:700,color:"#1c1917"}}>{useSupabase?"Connected to Supabase":"Using local storage only"}</p>
              <p style={{margin:"2px 0 0",fontSize:11,color:"#78716c"}}>{useSupabase?"Data syncs between both phones in real time":"Data is only saved on this device"}</p>
            </div>
          </div>

          {/* API key */}
          <p style={{margin:"0 0 4px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>
            {useSupabase?"Update Supabase Anon Key":"Connect to Supabase"}
          </p>
          <p style={{margin:"0 0 8px",fontSize:12,color:"#a8a29e",lineHeight:1.5}}>
            Go to Supabase → Project Settings → API → tap <strong>"Copy anonymous API key"</strong>
          </p>
          <input
            placeholder="eyJhbGciOiJIUzI1NiIs..."
            value={apiKey}
            onChange={e=>setApiKey(e.target.value)}
            style={{...inputSt(),fontFamily:"monospace",fontSize:11,marginBottom:8}}
          />
          <button onClick={save} disabled={!apiKey.trim()} style={{
            width:"100%",padding:13,
            background:saved?"#16a34a":apiKey.trim()?"#1c1917":"#e7e5e4",
            color:apiKey.trim()?"white":"#a8a29e",
            border:"none",borderRadius:10,fontFamily:"inherit",fontSize:14,fontWeight:700,
            cursor:apiKey.trim()?"pointer":"default",marginBottom:20,transition:"background 0.2s",
          }}>
            {saved?"✓ Connected!":"Save & Connect to Supabase"}
          </button>

          {/* SQL helper */}
          <div style={{background:"#fafaf9",border:"1px solid #e7e5e4",borderRadius:12,padding:"12px 14px",marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <p style={{margin:0,fontSize:12,fontWeight:700,color:"#44403c"}}>Need to set up your database?</p>
              <button onClick={copy} style={{...smallBtn("#1c1917"),fontSize:11}}>{copied?"Copied!":"Copy SQL"}</button>
            </div>
            <p style={{margin:0,fontSize:11,color:"#78716c",lineHeight:1.5}}>
              Run this SQL in <strong>Supabase → SQL Editor</strong>, then paste your anon key above.
            </p>
          </div>

          {/* Switch parent */}
          {currentParent && (
            <div style={{borderTop:"1px solid #f5f5f4",paddingTop:16}}>
              <p style={{margin:"0 0 8px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Signed in as</p>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#fafaf9",border:"1px solid #e7e5e4",borderRadius:10,padding:"10px 14px"}}>
                <span style={{fontSize:14,fontWeight:600,color:"#1c1917"}}>{currentParent}</span>
                <button onClick={onSwitchParent} style={{...smallBtn("#6b7280"),fontSize:11}}>Switch Parent</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Calendar ──────────────────────────────────────────────────────
function isoDay(y,m,d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function cOnDay(consequences,dateStr) {
  return consequences.filter(c=>{
    if(c.lifted_early) return false;
    const s=c.start_date||dateStr,e=c.end_date;
    if(dateStr<s) return false; if(e&&dateStr>e) return false; return true;
  });
}
function CalendarView({consequences,kids}) {
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth());
  const [sel,setSel]=useState(null);
  const today=todayStr();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const firstDay=new Date(year,month,1).getDay();
  const monthLabel=new Date(year,month).toLocaleDateString("en-US",{month:"long",year:"numeric"});
  function prev(){if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);setSel(null);}
  function next(){if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);setSel(null);}
  const cells=[];for(let i=0;i<firstDay;i++)cells.push(null);for(let d=1;d<=daysInMonth;d++)cells.push(d);
  const selDate=sel?isoDay(year,month,sel):null;
  const selC=selDate?cOnDay(consequences,selDate):[];
  return (
    <div style={{padding:"16px 16px 20px",maxWidth:520,margin:"0 auto"}}>
      <div style={{display:"flex",gap:16,marginBottom:14,justifyContent:"center"}}>
        {kids.map((kid,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:COLORS[i],display:"inline-block"}}/>
            <span style={{fontSize:12,color:"#78716c"}}>{kid}</span>
          </div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <button onClick={prev} style={{background:"none",border:"1px solid #e7e5e4",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18,color:"#44403c"}}>{"<"}</button>
        <span style={{fontWeight:700,fontSize:15,color:"#1c1917"}}>{monthLabel}</span>
        <button onClick={next} style={{background:"none",border:"1px solid #e7e5e4",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:18,color:"#44403c"}}>{">"}</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"#a8a29e",fontWeight:700}}>{d}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
        {cells.map((day,idx)=>{
          if(!day) return <div key={"e"+idx}/>;
          const ds=isoDay(year,month,day);
          const hits=cOnDay(consequences,ds);
          const kidIdxs=[...new Set(hits.map(c=>c.kid_idx))];
          const isToday=ds===today,isSel=sel===day;
          return (
            <div key={day} onClick={()=>setSel(isSel?null:day)} style={{borderRadius:8,padding:"6px 2px 4px",textAlign:"center",cursor:"pointer",minHeight:44,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",background:isSel?"#1c1917":isToday?"#f5f5f4":"white",border:isToday?"1.5px solid #a8a29e":"1px solid #e7e5e4"}}>
              <span style={{fontSize:13,fontWeight:isToday?700:400,color:isSel?"white":isToday?"#1c1917":"#44403c"}}>{day}</span>
              <div style={{display:"flex",gap:2,marginTop:3,justifyContent:"center"}}>
                {kidIdxs.map(ki=><span key={ki} style={{width:7,height:7,borderRadius:"50%",background:isSel?"white":COLORS[ki%COLORS.length],display:"inline-block"}}/>)}
              </div>
            </div>
          );
        })}
      </div>
      {selDate&&(
        <div style={{marginTop:16,background:"white",border:"1px solid #e7e5e4",borderRadius:12,padding:16}}>
          <p style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:"#44403c"}}>{new Date(selDate+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}</p>
          {selC.length===0?<p style={{margin:0,fontSize:13,color:"#a8a29e"}}>No active consequences this day 🌟</p>:selC.map(c=>(
            <div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:8}}>
              <span style={{width:10,height:10,borderRadius:"50%",background:COLORS[c.kid_idx%COLORS.length],flexShrink:0,marginTop:3}}/>
              <div>
                <p style={{margin:0,fontSize:13,fontWeight:600,color:"#1c1917"}}>{kids[c.kid_idx]}: {c.description}</p>
                {c.note&&<p style={{margin:"2px 0 0",fontSize:11,color:"#a8a29e",fontStyle:"italic"}}>"{c.note}"</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Weekly Summary ────────────────────────────────────────────────
function WeeklySummary({consequences,kids}) {
  const expiringSoon=consequences.filter(c=>{if(!isActive(c))return false;const left=daysLeft(c.end_date);return left!==null&&left<=3;});
  const resolvedThisWeek=consequences.filter(c=>{if(isActive(c))return false;if(!c.created_at)return false;const weekAgo=new Date();weekAgo.setDate(weekAgo.getDate()-7);return new Date(c.created_at)>weekAgo;});
  return (
    <div style={{padding:"16px",maxWidth:520,margin:"0 auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
        {kids.map((kid,i)=>{
          const kidActive=consequences.filter(c=>c.kid_idx===i&&isActive(c));
          const kidExpiring=kidActive.filter(c=>{const l=daysLeft(c.end_date);return l!==null&&l<=3;});
          return (
            <div key={i} style={{background:"white",border:`2px solid ${BORDER_COLORS[i]}`,borderRadius:14,padding:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:COLORS[i],display:"inline-block"}}/>
                <span style={{fontWeight:700,fontSize:14,color:"#1c1917"}}>{kid}</span>
              </div>
              <div style={{fontSize:28,fontWeight:700,color:COLORS[i],lineHeight:1}}>{kidActive.length}</div>
              <div style={{fontSize:11,color:"#a8a29e",marginBottom:8}}>ACTIVE</div>
              {kidExpiring.length>0&&<div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"6px 8px"}}><span style={{fontSize:11,color:"#dc2626",fontWeight:700}}>⚠ {kidExpiring.length} ending soon</span></div>}
              {kidActive.length===0&&<div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:8,padding:"6px 8px"}}><span style={{fontSize:11,color:"#16a34a",fontWeight:700}}>🌟 All clear!</span></div>}
            </div>
          );
        })}
      </div>
      {expiringSoon.length>0&&(
        <div style={{marginBottom:16}}>
          <p style={{margin:"0 0 8px",fontSize:11,color:"#dc2626",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>⏰ Expiring Within 3 Days</p>
          {expiringSoon.map(c=>(
            <div key={c.id} style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"10px 14px",marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><p style={{margin:0,fontSize:13,fontWeight:600,color:"#1c1917"}}>{kids[c.kid_idx]}: {c.description}</p><p style={{margin:"2px 0 0",fontSize:11,color:"#a8a29e"}}>Ends {formatDate(c.end_date)}</p></div>
              <StatusBadge c={c}/>
            </div>
          ))}
        </div>
      )}
      <p style={{margin:"0 0 8px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>✅ Resolved This Week</p>
      {resolvedThisWeek.length===0?<p style={{fontSize:13,color:"#a8a29e"}}>None yet this week.</p>:resolvedThisWeek.map(c=>(
        <div key={c.id} style={{background:"white",border:"1px solid #e7e5e4",borderRadius:10,padding:"10px 14px",marginBottom:6,opacity:0.7}}>
          <p style={{margin:0,fontSize:13,color:"#44403c"}}>{kids[c.kid_idx]}: {c.description}</p>
          <p style={{margin:"2px 0 0",fontSize:11,color:"#a8a29e"}}>Added {formatDateTime(c.created_at)}{c.added_by?` by ${c.added_by}`:""}</p>
        </div>
      ))}
    </div>
  );
}

// ── Behavior Journal ──────────────────────────────────────────────
function JournalView({kids,currentParent,useSupabase}) {
  const [entries,setEntries]=useState([]);
  const [activeKid,setActiveKid]=useState(0);
  const [newEntry,setNewEntry]=useState("");
  const [saving,setSaving]=useState(false);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    async function load(){
      if(useSupabase&&SUPABASE_ANON_KEY){try{const data=await sbFetch("/behavior_journal?order=created_at.desc&limit=50");setEntries(data);}catch{}}
      else{try{const raw=await window.storage.get("behavior_journal");if(raw)setEntries(JSON.parse(raw.value));}catch{}}
      setLoaded(true);
    }
    load();
  },[]);
  async function addEntry(){
    if(!newEntry.trim())return;setSaving(true);
    const entry={id:Date.now(),kid_idx:activeKid,entry:newEntry.trim(),added_by:currentParent,created_at:new Date().toISOString()};
    if(useSupabase&&SUPABASE_ANON_KEY){try{const[saved]=await sbFetch("/behavior_journal",{method:"POST",body:JSON.stringify({kid_idx:activeKid,entry:entry.entry,added_by:currentParent})});setEntries(prev=>[saved,...prev]);}catch{}}
    else{const updated=[entry,...entries];setEntries(updated);window.storage.set("behavior_journal",JSON.stringify(updated)).catch(()=>{});}
    setNewEntry("");setSaving(false);
  }
  const kidEntries=entries.filter(e=>e.kid_idx===activeKid);
  return (
    <div style={{padding:"16px",maxWidth:520,margin:"0 auto"}}>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {kids.map((kid,i)=><button key={i} onClick={()=>setActiveKid(i)} style={{flex:1,padding:"10px 8px",border:`2px solid ${activeKid===i?COLORS[i]:"#e7e5e4"}`,borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,background:activeKid===i?LIGHT_COLORS[i]:"white",color:activeKid===i?COLORS[i]:"#78716c"}}>{kid}</button>)}
      </div>
      <textarea placeholder={`Note something about ${kids[activeKid]}'s behavior...`} value={newEntry} onChange={e=>setNewEntry(e.target.value)} style={{...inputSt(),minHeight:80,resize:"vertical",marginBottom:8}}/>
      <button onClick={addEntry} disabled={saving||!newEntry.trim()} style={{padding:"10px 20px",background:COLORS[activeKid],color:"white",border:"none",borderRadius:10,fontFamily:"inherit",fontSize:13,fontWeight:700,cursor:newEntry.trim()?"pointer":"default",marginBottom:20,opacity:newEntry.trim()?1:0.5}}>
        {saving?"Saving…":"Add Note"}
      </button>
      {!loaded?<p style={{color:"#a8a29e",fontSize:13}}>Loading…</p>:kidEntries.length===0?<p style={{color:"#a8a29e",fontSize:13}}>No journal entries yet for {kids[activeKid]}.</p>:kidEntries.map(e=>(
        <div key={e.id} style={{background:"white",border:"1px solid #e7e5e4",borderRadius:10,padding:"12px 14px",marginBottom:8}}>
          <p style={{margin:0,fontSize:13,color:"#1c1917",lineHeight:1.5}}>{e.entry}</p>
          <p style={{margin:"6px 0 0",fontSize:11,color:"#a8a29e"}}>{formatDateTime(e.created_at)}{e.added_by?` · ${e.added_by}`:""}</p>
        </div>
      ))}
    </div>
  );
}

// ── Comment Thread ────────────────────────────────────────────────
function CommentThread({consequenceId,currentParent,useSupabase}) {
  const [comments,setComments]=useState([]);
  const [draft,setDraft]=useState("");
  const [open,setOpen]=useState(false);
  const [loading,setLoading]=useState(false);
  async function loadComments(){
    if(useSupabase&&SUPABASE_ANON_KEY){try{const data=await sbFetch(`/consequence_comments?consequence_id=eq.${consequenceId}&order=created_at.asc`);setComments(data);}catch{}}
    else{try{const raw=await window.storage.get(`comments_${consequenceId}`);if(raw)setComments(JSON.parse(raw.value));}catch{}}
  }
  function toggle(){if(!open)loadComments();setOpen(o=>!o);}
  async function addComment(){
    if(!draft.trim())return;setLoading(true);
    const c={id:Date.now(),consequence_id:consequenceId,author:currentParent,body:draft.trim(),created_at:new Date().toISOString()};
    if(useSupabase&&SUPABASE_ANON_KEY){try{const[saved]=await sbFetch("/consequence_comments",{method:"POST",body:JSON.stringify({consequence_id:consequenceId,author:currentParent,body:c.body})});setComments(prev=>[...prev,saved]);}catch{}}
    else{const updated=[...comments,c];setComments(updated);window.storage.set(`comments_${consequenceId}`,JSON.stringify(updated)).catch(()=>{});}
    setDraft("");setLoading(false);
  }
  return (
    <div style={{marginTop:10}}>
      <button onClick={toggle} style={{background:"none",border:"none",cursor:"pointer",color:"#a8a29e",fontSize:12,fontFamily:"inherit",padding:0}}>
        {open?"▾ Hide notes":`▸ Parent notes${comments.length>0?` (${comments.length})`:""}`}
      </button>
      {open&&(
        <div style={{marginTop:8}}>
          {comments.map(c=>(
            <div key={c.id} style={{background:"#f5f5f4",borderRadius:8,padding:"8px 10px",marginBottom:6}}>
              <p style={{margin:0,fontSize:12,color:"#1c1917"}}>{c.body}</p>
              <p style={{margin:"3px 0 0",fontSize:10,color:"#a8a29e"}}>{c.author} · {formatDateTime(c.created_at)}</p>
            </div>
          ))}
          <div style={{display:"flex",gap:6,marginTop:6}}>
            <input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Leave a note for your partner…" onKeyDown={e=>e.key==="Enter"&&addComment()} style={{...inputSt(),flex:1,padding:"6px 8px",fontSize:12}}/>
            <button onClick={addComment} disabled={loading||!draft.trim()} style={{padding:"6px 12px",background:"#1c1917",color:"white",border:"none",borderRadius:8,fontFamily:"inherit",fontSize:12,cursor:"pointer",opacity:draft.trim()?1:0.4}}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick-Add Modal ───────────────────────────────────────────────
function QuickAddModal({kids,consequences,currentParent,onAdd,onClose}) {
  const [step,setStep]=useState(1);
  const [selected,setSelected]=useState(null);
  const [customText,setCustomText]=useState("");
  const [kidIdx,setKidIdx]=useState(0);
  const [durationDays,setDurationDays]=useState(7);
  const [startDate,setStartDate]=useState(todayStr());
  const [note,setNote]=useState("");
  const [openCat,setOpenCat]=useState(0);
  const [overlapWarning,setOverlapWarning]=useState(null);
  const [saving,setSaving]=useState(false);
  const canProceed=selected?.custom?customText.trim().length>0:!!selected;
  const descText=selected?.custom?customText.trim():selected?.text||"";
  async function submit(){
    if(!descText)return;
    const endDate=durationDays?addDays(startDate,durationDays-1):null;
    const overlapping=getOverlappingActive(consequences,kidIdx,startDate,endDate);
    if(overlapping.length>=2&&!overlapWarning){setOverlapWarning({overlapping,endDate});return;}
    setSaving(true);
    await onAdd({description:descText,kid_idx:kidIdx,start_date:startDate,end_date:endDate,note,added_by:currentParent});
    setSaving(false);
  }
  async function confirmAnyway(){
    const endDate=overlapWarning?.endDate??(durationDays?addDays(startDate,durationDays-1):null);
    setSaving(true);
    await onAdd({description:descText,kid_idx:kidIdx,start_date:startDate,end_date:endDate,note,added_by:currentParent});
    setSaving(false);
  }
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:50,display:"flex",alignItems:"flex-end"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"white",borderRadius:"20px 20px 0 0",width:"100%",maxHeight:"88vh",overflowY:"auto",paddingBottom:32,position:"relative"}}>
        <div style={{display:"flex",justifyContent:"center",padding:"12px 0 0"}}><div style={{width:36,height:4,borderRadius:2,background:"#e7e5e4"}}/></div>
        {step===1&&(<>
          <div style={{padding:"12px 20px 14px",borderBottom:"1px solid #f5f5f4"}}>
            <h2 style={{margin:0,fontSize:18,fontWeight:700,color:"#1c1917"}}>Choose a Consequence</h2>
            <p style={{margin:"4px 0 0",fontSize:13,color:"#a8a29e"}}>Tap a category, then select one</p>
          </div>
          <div style={{padding:"12px 16px"}}>
            {PRESET_CATEGORIES.map((cat,ci)=>(
              <div key={ci} style={{marginBottom:8}}>
                <button onClick={()=>setOpenCat(openCat===ci?-1:ci)} style={{width:"100%",background:openCat===ci?"#1c1917":"#fafaf9",border:"1px solid #e7e5e4",borderRadius:openCat===ci?"10px 10px 0 0":10,padding:"11px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",fontFamily:"inherit"}}>
                  <span style={{fontSize:14,fontWeight:700,color:openCat===ci?"white":"#1c1917"}}>{cat.icon} {cat.category}</span>
                  <span style={{fontSize:11,color:openCat===ci?"#a8a29e":"#78716c"}}>{openCat===ci?"▲":"▼"}</span>
                </button>
                {openCat===ci&&(
                  <div style={{border:"1px solid #e7e5e4",borderTop:"none",borderRadius:"0 0 10px 10px",overflow:"hidden"}}>
                    {cat.items.map((item,ii)=>{
                      const isSel=selected?.text===item&&!selected?.custom;
                      return (
                        <div key={ii} onClick={()=>setSelected({text:item,custom:false})} style={{padding:"11px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:12,background:isSel?"#fff7ed":ii%2===0?"white":"#fafaf9",borderBottom:ii<cat.items.length-1?"1px solid #f5f5f4":"none"}}>
                          <div style={{width:20,height:20,borderRadius:6,flexShrink:0,border:isSel?"none":"2px solid #e7e5e4",background:isSel?"#f97316":"white",display:"flex",alignItems:"center",justifyContent:"center"}}>
                            {isSel&&<span style={{color:"white",fontSize:12,fontWeight:700}}>✓</span>}
                          </div>
                          <span style={{fontSize:13,color:"#1c1917",lineHeight:1.4}}>{item}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            <div style={{marginTop:4,padding:"12px 14px",background:"#fafaf9",border:"1px solid #e7e5e4",borderRadius:10}}>
              <div onClick={()=>setSelected({text:"",custom:true})} style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer",marginBottom:selected?.custom?10:0}}>
                <div style={{width:20,height:20,borderRadius:6,flexShrink:0,border:selected?.custom?"none":"2px solid #e7e5e4",background:selected?.custom?"#f97316":"white",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {selected?.custom&&<span style={{color:"white",fontSize:12,fontWeight:700}}>✓</span>}
                </div>
                <span style={{fontSize:13,fontWeight:600,color:"#1c1917"}}>✏️ Write a custom consequence</span>
              </div>
              {selected?.custom&&<input autoFocus placeholder="Type your consequence here…" value={customText} onChange={e=>setCustomText(e.target.value)} style={{...inputSt(),marginTop:4}}/>}
            </div>
          </div>
          <div style={{padding:"0 16px"}}>
            <button onClick={()=>canProceed&&setStep(2)} style={{width:"100%",padding:14,background:canProceed?"#1c1917":"#e7e5e4",color:canProceed?"white":"#a8a29e",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:canProceed?"pointer":"default"}}>Continue →</button>
          </div>
        </>)}
        {step===2&&(<>
          <div style={{padding:"12px 20px 14px",borderBottom:"1px solid #f5f5f4"}}>
            <button onClick={()=>setStep(1)} style={{background:"none",border:"none",cursor:"pointer",color:"#a8a29e",fontSize:13,fontFamily:"inherit",padding:0,marginBottom:6}}>← Back</button>
            <h2 style={{margin:0,fontSize:18,fontWeight:700,color:"#1c1917"}}>Assign & Set Duration</h2>
            <p style={{margin:"6px 0 0",fontSize:13,color:"#44403c",fontStyle:"italic",lineHeight:1.4,background:"#f5f5f4",padding:"8px 10px",borderRadius:8}}>"{descText}"</p>
          </div>
          <div style={{padding:"16px"}}>
            <p style={{margin:"0 0 8px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Assign to</p>
            <div style={{display:"flex",gap:8,marginBottom:20}}>
              {kids.map((kid,i)=><button key={i} onClick={()=>setKidIdx(i)} style={{flex:1,padding:"12px 8px",border:`2px solid ${kidIdx===i?COLORS[i]:"#e7e5e4"}`,borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700,background:kidIdx===i?LIGHT_COLORS[i]:"white",color:kidIdx===i?COLORS[i]:"#78716c"}}>{kid}</button>)}
            </div>
            <p style={{margin:"0 0 8px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Start date</p>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{...inputSt(),marginBottom:20}}/>
            <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:4}}>
              <p style={{margin:0,fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Duration</p>
              <span style={{fontSize:11,color:"#dc2626",fontWeight:600}}>max 30 days</span>
            </div>
            <p style={{margin:"0 0 10px",fontSize:12,color:"#78716c"}}>{durationDays?`Ends: ${formatDate(addDays(startDate,durationDays-1))}`:"No end date (ongoing)"}</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:20}}>
              {DURATION_OPTIONS.map(opt=><button key={opt.days} onClick={()=>setDurationDays(opt.days)} style={{padding:"10px 4px",border:`2px solid ${durationDays===opt.days?"#1c1917":"#e7e5e4"}`,borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:durationDays===opt.days?"#1c1917":"white",color:durationDays===opt.days?"white":"#44403c",textAlign:"center",lineHeight:1.3}}>{opt.label}</button>)}
              <button onClick={()=>setDurationDays(null)} style={{padding:"10px 4px",border:`2px solid ${durationDays===null?"#1c1917":"#e7e5e4"}`,borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,background:durationDays===null?"#1c1917":"white",color:durationDays===null?"white":"#44403c",textAlign:"center",lineHeight:1.3,gridColumn:"span 2"}}>Ongoing (no end date)</button>
            </div>
            <p style={{margin:"0 0 8px",fontSize:11,color:"#78716c",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>Note (optional)</p>
            <input placeholder="e.g. No exceptions on weekends" value={note} onChange={e=>setNote(e.target.value)} style={{...inputSt(),marginBottom:20}}/>
            <button onClick={submit} disabled={saving} style={{width:"100%",padding:14,background:COLORS[kidIdx],color:"white",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer",boxShadow:`0 4px 14px ${COLORS[kidIdx]}44`,opacity:saving?0.7:1}}>
              {saving?"Saving…":`Assign to ${kids[kidIdx]} ✓`}
            </button>
          </div>
        </>)}
        {overlapWarning&&(
          <div style={{position:"absolute",inset:0,background:"rgba(255,255,255,0.97)",borderRadius:"20px 20px 0 0",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px 20px",zIndex:10}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <h3 style={{margin:"0 0 8px",fontSize:18,fontWeight:700,color:"#1c1917",textAlign:"center"}}>Too Many Consequences</h3>
            <p style={{margin:"0 0 16px",fontSize:14,color:"#78716c",textAlign:"center",lineHeight:1.5}}><strong>{kids[kidIdx]}</strong> already has {overlapWarning.overlapping.length} active consequences during this period:</p>
            <div style={{width:"100%",marginBottom:20,display:"flex",flexDirection:"column",gap:8}}>
              {overlapWarning.overlapping.map(c=>(
                <div key={c.id} style={{background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"flex-start",gap:10}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:COLORS[kidIdx%COLORS.length],flexShrink:0,marginTop:4}}/>
                  <div>
                    <p style={{margin:0,fontSize:13,fontWeight:600,color:"#1c1917"}}>{c.description}</p>
                    <p style={{margin:"2px 0 0",fontSize:11,color:"#a8a29e"}}>{formatDate(c.start_date)}{c.end_date?` – ${formatDate(c.end_date)}`:" (ongoing)"}</p>
                  </div>
                </div>
              ))}
            </div>
            <p style={{margin:"0 0 20px",fontSize:13,color:"#dc2626",fontWeight:600,textAlign:"center"}}>We recommend resolving an existing consequence first.</p>
            <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%"}}>
              <button onClick={()=>setOverlapWarning(null)} style={{width:"100%",padding:14,background:"#1c1917",color:"white",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer"}}>← Go Back & Review</button>
              <button onClick={confirmAnyway} disabled={saving} style={{width:"100%",padding:12,background:"white",color:"#dc2626",border:"2px solid #dc2626",borderRadius:12,fontFamily:"inherit",fontSize:14,fontWeight:600,cursor:"pointer"}}>{saving?"Saving…":"Add Anyway"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [kids]=useState(DEFAULT_KIDS);
  const [consequences,setConsequences]=useState([]);
  const [activeTab,setActiveTab]=useState(0);
  const [view,setView]=useState("list");
  const [showQuickAdd,setShowQuickAdd]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [currentParent,setCurrentParent]=useState(null);
  const [setupDone,setSetupDone]=useState(false);
  const [useSupabase,setUseSupabase]=useState(false);
  const [loading,setLoading]=useState(true);
  const [syncing,setSyncing]=useState(false);
  const pollRef=useRef(null);

  useEffect(()=>{
    async function init(){
      try{
        const ak=await window.storage.get("supabase_anon_key");
        if(ak&&ak.value) SUPABASE_ANON_KEY=ak.value;
        const sd=await window.storage.get("setup_done_v2");
        const cp=await window.storage.get("current_parent");
        const useSb=await window.storage.get("use_supabase");
        if(sd){
          setSetupDone(true);
          if(cp) setCurrentParent(cp.value);
          if(useSb) setUseSupabase(useSb.value==="true");
        }
      }catch{}
      setLoading(false);
    }
    init();
  },[]);

  useEffect(()=>{
    if(!setupDone) return;
    loadConsequences();
    if(useSupabase&&SUPABASE_ANON_KEY){
      pollRef.current=setInterval(loadConsequences,15000);
    }
    return()=>clearInterval(pollRef.current);
  },[setupDone,useSupabase]);

  async function loadConsequences(){
    if(useSupabase&&SUPABASE_ANON_KEY){
      try{setSyncing(true);const data=await sbFetch("/consequences?order=created_at.desc");setConsequences(data);}catch{}finally{setSyncing(false);}
    }else{
      try{const raw=await window.storage.get("consequences_v2");if(raw)setConsequences(JSON.parse(raw.value));}catch{}
    }
  }

  function saveLocal(updated){window.storage.set("consequences_v2",JSON.stringify(updated)).catch(()=>{});}

  function handleSettingsSave(key){
    const useSb=key.trim().length>30;
    if(useSb){SUPABASE_ANON_KEY=key.trim();window.storage.set("supabase_anon_key",key.trim());}
    setUseSupabase(useSb);
    window.storage.set("use_supabase",useSb?"true":"false");
    window.storage.set("setup_done_v2","true");
    setSetupDone(true);
    setShowSettings(false);
    setTimeout(loadConsequences,300);
  }

  async function handleAdd(data){
    if(useSupabase&&SUPABASE_ANON_KEY){
      try{const[saved]=await sbFetch("/consequences",{method:"POST",body:JSON.stringify(data)});setConsequences(prev=>[saved,...prev]);}
      catch(e){alert("Save failed: "+e.message);}
    }else{
      const newC={id:Date.now(),...data,lifted_early:false,created_at:new Date().toISOString()};
      const updated=[newC,...consequences];setConsequences(updated);saveLocal(updated);
    }
    setShowQuickAdd(false);
  }

  async function liftEarly(id){
    if(useSupabase&&SUPABASE_ANON_KEY){try{await sbFetch(`/consequences?id=eq.${id}`,{method:"PATCH",body:JSON.stringify({lifted_early:true})});setConsequences(prev=>prev.map(c=>c.id===id?{...c,lifted_early:true}:c));}catch{}}
    else{const updated=consequences.map(c=>c.id===id?{...c,lifted_early:true}:c);setConsequences(updated);saveLocal(updated);}
  }

  async function deleteC(id){
    if(useSupabase&&SUPABASE_ANON_KEY){try{await sbFetch(`/consequences?id=eq.${id}`,{method:"DELETE",prefer:""});setConsequences(prev=>prev.filter(c=>c.id!==id));}catch{}}
    else{const updated=consequences.filter(c=>c.id!==id);setConsequences(updated);saveLocal(updated);}
  }

  // Settings modal — rendered on ALL screens
  const settingsModal = showSettings && (
    <SettingsModal
      useSupabase={useSupabase}
      currentParent={currentParent||""}
      onSaveKey={handleSettingsSave}
      onSwitchParent={()=>{setCurrentParent(null);window.storage.set("current_parent","");setShowSettings(false);}}
      onClose={()=>setShowSettings(false)}
    />
  );

  if(loading) return <div style={{minHeight:"100vh",background:"#fafaf9",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Georgia",color:"#a8a29e"}}>Loading…</div>;

  // ── Setup screen ──
  if(!setupDone) return (
    <div style={{minHeight:"100vh",background:"#fafaf9",fontFamily:"'Georgia',serif",display:"flex",flexDirection:"column",padding:20}}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        <GearBtn onOpen={()=>setShowSettings(true)}/>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{maxWidth:480,width:"100%"}}>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:40,marginBottom:8}}>🗄️</div>
            <h1 style={{fontSize:22,fontWeight:700,color:"#1c1917",margin:"0 0 8px"}}>Supabase Setup</h1>
            <p style={{fontSize:14,color:"#78716c",margin:0,lineHeight:1.5}}>To sync between you and your husband's phones, paste your Supabase anon key below.</p>
          </div>
          <div style={{background:"white",border:"1px solid #e7e5e4",borderRadius:12,padding:16,marginBottom:16}}>
            <p style={{margin:"0 0 6px",fontSize:12,fontWeight:700,color:"#44403c",letterSpacing:"0.05em"}}>Paste your Supabase Anon Key</p>
            <p style={{margin:"0 0 10px",fontSize:11,color:"#a8a29e",lineHeight:1.5}}>Supabase → Project Settings → API → "Copy anonymous API key"</p>
            <input
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              onChange={e=>{ if(e.target.value.trim().length>30) handleSettingsSave(e.target.value.trim()); }}
              style={{...inputSt(),fontFamily:"monospace",fontSize:11}}
            />
          </div>
          <button onClick={()=>handleSettingsSave("")} style={{width:"100%",padding:14,background:"#1c1917",color:"white",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:10}}>
            Skip (use local storage only)
          </button>
          <p style={{fontSize:11,color:"#a8a29e",textAlign:"center",margin:0}}>You can connect to Supabase later by tapping ⚙️ in the app.</p>
        </div>
      </div>
      {settingsModal}
    </div>
  );

  // ── Parent selector ──
  if(!currentParent) return (
    <div style={{minHeight:"100vh",background:"#fafaf9",fontFamily:"'Georgia',serif",display:"flex",flexDirection:"column",padding:20}}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        <GearBtn onOpen={()=>setShowSettings(true)}/>
      </div>
      <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{textAlign:"center",maxWidth:320,width:"100%"}}>
          <div style={{fontSize:40,marginBottom:12}}>👋</div>
          <h2 style={{fontSize:20,fontWeight:700,color:"#1c1917",margin:"0 0 8px"}}>Who's using the app?</h2>
          <p style={{fontSize:14,color:"#78716c",margin:"0 0 24px"}}>This helps track who added each consequence.</p>
          {["Mom","Dad"].map(name=>(
            <button key={name} onClick={()=>{setCurrentParent(name);window.storage.set("current_parent",name);}} style={{display:"block",width:"100%",padding:14,marginBottom:10,background:"#1c1917",color:"white",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:16,fontWeight:700,cursor:"pointer"}}>{name}</button>
          ))}
        </div>
      </div>
      {settingsModal}
    </div>
  );

  const accent=COLORS[activeTab%COLORS.length];
  const lightBg=LIGHT_COLORS[activeTab%LIGHT_COLORS.length];
  const borderCol=BORDER_COLORS[activeTab%BORDER_COLORS.length];
  const kidC=consequences.filter(c=>c.kid_idx===activeTab);
  const activeOnes=kidC.filter(isActive);
  const inactiveOnes=kidC.filter(c=>!isActive(c));
  const displayed=showHistory?kidC:activeOnes;
  const NAV_TABS=[{id:"list",label:"List",icon:"☰"},{id:"calendar",label:"Calendar",icon:"📅"},{id:"weekly",label:"Summary",icon:"📊"},{id:"journal",label:"Journal",icon:"📓"}];

  return (
    <div style={{minHeight:"100vh",background:"#fafaf9",fontFamily:"'Georgia',serif",paddingBottom:72}}>
      {/* Header */}
      <div style={{background:"#1c1917",padding:"20px 20px 0",position:"sticky",top:0,zIndex:10}}>
        <div style={{maxWidth:520,margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
            <div>
              <p style={{color:"#a8a29e",fontSize:10,letterSpacing:"0.15em",textTransform:"uppercase",margin:0}}>Family</p>
              <h1 style={{color:"#fafaf9",fontSize:20,fontWeight:400,margin:"2px 0 0",letterSpacing:"-0.01em"}}>Consequence Tracker</h1>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              {syncing&&<span style={{fontSize:10,color:"#a8a29e"}}>↻</span>}
              <GearBtn onOpen={()=>setShowSettings(true)}/>
              <button onClick={()=>{setCurrentParent(null);window.storage.set("current_parent","");}} style={{background:"#292524",border:"none",borderRadius:8,padding:"4px 10px",color:"#a8a29e",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                {currentParent} ▾
              </button>
            </div>
          </div>
          {view==="list"?(
            <div style={{display:"flex",gap:4,marginTop:12}}>
              {kids.map((kid,i)=>(
                <button key={i} onClick={()=>setActiveTab(i)} style={{padding:"10px 20px",border:"none",borderRadius:"8px 8px 0 0",cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:activeTab===i?700:400,background:activeTab===i?LIGHT_COLORS[i%LIGHT_COLORS.length]:"#292524",color:activeTab===i?COLORS[i%COLORS.length]:"#a8a29e",transition:"all 0.15s",position:"relative"}}>
                  {kid}
                  {consequences.filter(c=>c.kid_idx===i&&isActive(c)).length>0&&<span style={{position:"absolute",top:6,right:6,width:7,height:7,borderRadius:"50%",background:COLORS[i%COLORS.length]}}/>}
                </button>
              ))}
            </div>
          ):(
            <div style={{paddingBottom:14,paddingTop:8}}>
              <span style={{color:"#e7e5e4",fontSize:13,fontWeight:600}}>{view==="calendar"?"All Kids · Calendar":view==="weekly"?"Weekly Summary":"Behavior Journal"}</span>
            </div>
          )}
        </div>
      </div>

      {/* List View */}
      {view==="list"&&(
        <div style={{maxWidth:520,margin:"0 auto",padding:"0 16px 20px"}}>
          <div style={{background:lightBg,border:`1px solid ${borderCol}`,borderTop:"none",borderRadius:"0 0 12px 12px",padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <span style={{fontSize:13,color:"#44403c",fontWeight:600}}>{kids[activeTab]}</span>
            {useSupabase&&SUPABASE_ANON_KEY&&<button onClick={loadConsequences} style={{background:"none",border:"none",cursor:"pointer",color:"#a8a29e",fontSize:11,fontFamily:"inherit"}}>↻ refresh</button>}
          </div>
          <div style={{display:"flex",gap:8,marginBottom:16}}>
            {[["Active",activeOnes.length,accent],["Total",kidC.length,"#78716c"],["Resolved",inactiveOnes.length,"#a8a29e"]].map(([l,v,c])=>(
              <div key={l} style={{flex:1,background:"white",border:"1px solid #e7e5e4",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                <div style={{fontSize:22,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
                <div style={{fontSize:10,color:"#a8a29e",marginTop:2,letterSpacing:"0.05em"}}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>
          <button onClick={()=>setShowQuickAdd(true)} style={{width:"100%",padding:"13px",background:accent,color:"white",border:"none",borderRadius:12,fontFamily:"inherit",fontSize:15,fontWeight:700,cursor:"pointer",marginBottom:16,boxShadow:`0 4px 14px ${accent}44`,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
            <span style={{fontSize:18}}>+</span> Add Consequence
          </button>
          {inactiveOnes.length>0&&<button onClick={()=>setShowHistory(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",color:"#a8a29e",fontSize:12,fontFamily:"inherit",marginBottom:8,padding:0}}>{showHistory?"▾ Hide resolved":`▸ Show ${inactiveOnes.length} resolved`}</button>}
          {displayed.length===0?(
            <div style={{textAlign:"center",padding:"40px 20px",color:"#a8a29e"}}>
              <div style={{fontSize:36,marginBottom:8}}>🌟</div>
              <p style={{margin:0,fontSize:14}}>No active consequences for {kids[activeTab]}!</p>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {displayed.map(c=>{
                const active=isActive(c);
                return (
                  <div key={c.id} style={{background:active?"white":"#fafaf9",border:`1px solid ${active?borderCol:"#e7e5e4"}`,borderRadius:12,padding:"14px 16px",opacity:active?1:0.65}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <p style={{margin:0,fontSize:15,color:"#1c1917",fontWeight:600,flex:1,lineHeight:1.4}}>{c.description}</p>
                      <StatusBadge c={c}/>
                    </div>
                    <p style={{margin:"4px 0 0",fontSize:12,color:"#78716c"}}>Started {formatDate(c.start_date)}{c.end_date?` · Ends ${formatDate(c.end_date)}`:" · Ongoing"}</p>
                    {c.added_by&&<p style={{margin:"2px 0 0",fontSize:11,color:"#a8a29e"}}>Added by {c.added_by} · {formatDateTime(c.created_at)}</p>}
                    {c.note&&<p style={{margin:"4px 0 0",fontSize:12,color:"#a8a29e",fontStyle:"italic"}}>"{c.note}"</p>}
                    {active&&<div style={{display:"flex",gap:8,marginTop:10}}><button onClick={()=>liftEarly(c.id)} style={smallBtn("#16a34a")}>✓ Lift early</button><button onClick={()=>deleteC(c.id)} style={smallBtn("#dc2626")}>Delete</button></div>}
                    {!active&&<button onClick={()=>deleteC(c.id)} style={{...smallBtn("#9ca3af"),marginTop:8}}>Remove</button>}
                    <CommentThread consequenceId={c.id} currentParent={currentParent} useSupabase={useSupabase}/>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view==="calendar"&&<CalendarView consequences={consequences} kids={kids}/>}
      {view==="weekly"&&<WeeklySummary consequences={consequences} kids={kids}/>}
      {view==="journal"&&<JournalView kids={kids} currentParent={currentParent} useSupabase={useSupabase}/>}

      {/* Bottom Nav */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:"white",borderTop:"1px solid #e7e5e4",display:"flex",zIndex:20,boxShadow:"0 -4px 20px rgba(0,0,0,0.06)"}}>
        {NAV_TABS.map(tab=>(
          <button key={tab.id} onClick={()=>setView(tab.id)} style={{flex:1,padding:"10px 0 8px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",alignItems:"center",gap:1,color:view===tab.id?"#1c1917":"#a8a29e"}}>
            <span style={{fontSize:18,lineHeight:1}}>{tab.icon}</span>
            <span style={{fontSize:9,fontWeight:view===tab.id?700:400,letterSpacing:"0.04em"}}>{tab.label.toUpperCase()}</span>
            {view===tab.id&&<span style={{width:16,height:2,background:"#1c1917",borderRadius:2}}/>}
          </button>
        ))}
      </div>

      {showQuickAdd&&<QuickAddModal kids={kids} consequences={consequences} currentParent={currentParent} onAdd={handleAdd} onClose={()=>setShowQuickAdd(false)}/>}
      {settingsModal}
    </div>
  );
}
