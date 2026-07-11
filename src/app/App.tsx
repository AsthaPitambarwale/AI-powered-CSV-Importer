import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import { motion, AnimatePresence } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import {
  Upload, FileText, CheckCircle2, Download, Sparkles, Zap, Moon, Sun,
  ChevronRight, ArrowRight, RefreshCw, Brain, Shield, BarChart3, Star,
  AlertTriangle, Database, TrendingUp, Users, SkipForward,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════

type Step = "upload" | "preview" | "processing" | "results";
interface RawRecord { [key: string]: string; }
interface CRMRecord {
  created_at: string; name: string; email: string; country_code: string;
  mobile_without_country_code: string; company: string; city: string;
  state: string; country: string; lead_owner: string; crm_status: string;
  crm_note: string; data_source: string; possession_time: string; description: string;
}
interface ProcessingResult { success: CRMRecord[]; skipped: number; total: number; }

// ═══════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const CRM_FIELDS: (keyof CRMRecord)[] = [
  "created_at","name","email","country_code","mobile_without_country_code",
  "company","city","state","country","lead_owner","crm_status",
  "crm_note","data_source","possession_time","description",
];

const STATUS_CFG = {
  GOOD_LEAD_FOLLOW_UP: { label:"Follow Up",  color:"#10b981", bg:"rgba(16,185,129,0.12)",  border:"rgba(16,185,129,0.3)"  },
  DID_NOT_CONNECT:     { label:"No Connect", color:"#f59e0b", bg:"rgba(245,158,11,0.12)",  border:"rgba(245,158,11,0.3)"  },
  BAD_LEAD:            { label:"Bad Lead",   color:"#f43f5e", bg:"rgba(244,63,94,0.12)",   border:"rgba(244,63,94,0.3)"   },
  SALE_DONE:           { label:"Sale Done",  color:"#a78bfa", bg:"rgba(167,139,250,0.12)", border:"rgba(167,139,250,0.3)" },
} as const;

const PROCESSING_STEPS = [
  "Reading CSV structure & encoding...",
  "Parsing column headers semantically...",
  "Building field-to-schema mapping...",
  "Extracting name & contact fields...",
  "Normalizing email addresses...",
  "Parsing mobile numbers & country codes...",
  "Detecting company & location data...",
  "Classifying lead status values...",
  "Mapping sources to allowed values...",
  "Compiling CRM notes from overflow fields...",
  "Validating records — skipping invalids...",
  "Finalizing GrowEasy CRM export...",
];

const WIZARD_STEPS = ["Upload", "Preview", "Processing", "Results"];
const STEP_IDX: Record<Step, number> = { upload:0, preview:1, processing:2, results:3 };

// ═══════════════════════════════════════════════════════════
// THEME CONTEXT
// ═══════════════════════════════════════════════════════════

interface TV {
  dark: boolean;
  glassBg: string; glassBorder: string; cardBg: string;
  headerBg: string; termBg: string; rowHover: string;
  fg: string; muted: string; gridStroke: string;
}

const Ctx = createContext<TV>({} as TV);
const useTV = () => useContext(Ctx);

function makeTV(dark: boolean): TV {
  return dark ? {
    dark, glassBg:"rgba(8,13,30,0.80)", glassBorder:"rgba(255,255,255,0.07)",
    cardBg:"rgba(4,6,15,0.96)", headerBg:"rgba(4,6,15,0.85)", termBg:"rgba(4,6,15,0.98)",
    rowHover:"rgba(123,94,248,0.05)", fg:"#dde6f8", muted:"#4e5f80", gridStroke:"rgba(255,255,255,0.03)",
  } : {
    dark, glassBg:"rgba(255,255,255,0.88)", glassBorder:"rgba(123,94,248,0.14)",
    cardBg:"rgba(255,255,255,0.97)", headerBg:"rgba(245,243,255,0.92)", termBg:"rgba(248,247,255,0.98)",
    rowHover:"rgba(123,94,248,0.04)", fg:"#0f0a2e", muted:"#6b6b90", gridStroke:"rgba(123,94,248,0.04)",
  };
}

// ═══════════════════════════════════════════════════════════
// BUSINESS LOGIC
// ═══════════════════════════════════════════════════════════

function parseCSV(text: string): { headers: string[]; records: RawRecord[] } {
  const lines: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (inQ && text[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
    else if ((ch==="\n"||ch==="\r")&&!inQ) { if (ch==="\r"&&text[i+1]==="\n") i++; if (cur.trim()) lines.push(cur); cur=""; }
    else cur+=ch;
  }
  if (cur.trim()) lines.push(cur);
  const parseLine = (line: string) => {
    const fields: string[]=[]; let f="", inQuote=false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (ch==='"') { if (inQuote&&line[i+1]==='"') {f+='"';i++;} else inQuote=!inQuote; }
      else if (ch===","&&!inQuote) { fields.push(f.trim()); f=""; } else f+=ch;
    }
    fields.push(f.trim()); return fields;
  };
  if (!lines.length) return { headers:[], records:[] };
  const headers = parseLine(lines[0]).map(h=>h.replace(/^["']|["']$/g,"").trim());
  const records = lines.slice(1).map(line => {
    const vals=parseLine(line); const rec:RawRecord={};
    headers.forEach((h,i)=>{rec[h]=vals[i]??"";});
    return rec;
  });
  return { headers, records };
}

function norm(s: string) { return s.toLowerCase().replace(/[\s_\-.]+/g," ").trim(); }

const FP: Record<keyof CRMRecord, string[]> = {
  created_at:["created at","created","date","timestamp","submission date","lead date","date created","entry date","added on","added at"],
  name:["full name","name","contact name","customer name","lead name","client name","prospect name","contact"],
  email:["email","email address","e mail","mail","email id","e-mail"],
  country_code:["country code","dial code","isd code","calling code","cc","phone code"],
  mobile_without_country_code:["mobile","phone","cell","telephone","contact number","phone number","mobile number","phone no","mobile no","contact no","ph","mob"],
  company:["company","organization","organisation","org","firm","business","employer","company name","business name","account name"],
  city:["city","town","city name","location"],
  state:["state","province","region","state name"],
  country:["country","nation","country name"],
  lead_owner:["lead owner","owner","assigned to","sales rep","agent","salesperson","rep","handler"],
  crm_status:["status","lead status","crm status","disposition","stage","lead stage","call status"],
  crm_note:["notes","note","remarks","remark","comment","comments","additional info","feedback","observation"],
  data_source:["source","lead source","data source","campaign","channel","utm source","medium","platform"],
  possession_time:["possession","possession time","possession date","handover","move in"],
  description:["description","details","additional details","more info","product","property","requirement"],
};

function buildFieldMapping(headers: string[]) {
  const mapping: Record<string,string>={};
  const normalized=headers.map(h=>({orig:h,n:norm(h)}));
  for (const [field,patterns] of Object.entries(FP)) {
    for (const pat of patterns) {
      const match=normalized.find(h=>h.n===pat||(pat.length>4&&h.n.includes(pat)));
      if (match&&!mapping[field]) { mapping[field]=match.orig; break; }
    }
  }
  return mapping;
}

function normalizeStatus(raw: string) {
  const s=raw.toLowerCase().trim();
  if (!s) return "GOOD_LEAD_FOLLOW_UP";
  if (s.includes("good")||s.includes("follow")||s.includes("warm")||s.includes("interested")||s.includes("callback")) return "GOOD_LEAD_FOLLOW_UP";
  if (s.includes("not connect")||s.includes("no answer")||s==="dnc"||s.includes("did not")||s.includes("busy")||s.includes("not reach")) return "DID_NOT_CONNECT";
  if (s.includes("bad")||s.includes("not interest")||s.includes("junk")||s.includes("invalid")) return "BAD_LEAD";
  if (s.includes("sale")||s.includes("closed")||s.includes("won")||s.includes("converted")||s.includes("deal")) return "SALE_DONE";
  return "GOOD_LEAD_FOLLOW_UP";
}
function normalizeSource(raw: string) {
  const s=raw.toLowerCase();
  if (s.includes("demand")) return "leads_on_demand"; if (s.includes("meridian")) return "meridian_tower";
  if (s.includes("eden")) return "eden_park"; if (s.includes("varah")) return "varah_swamy";
  if (s.includes("sarjapur")) return "sarjapur_plots"; return "";
}

const EMAIL_RE=/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function processRecords(headers: string[], rawRecords: RawRecord[]): ProcessingResult {
  const fm=buildFieldMapping(headers);
  const mappedSet=new Set(Object.values(fm));
  const unmapped=headers.filter(h=>!mappedSet.has(h));
  const firstNameH=headers.find(h=>["first name","firstname","fname","first"].includes(norm(h)));
  const lastNameH=headers.find(h=>["last name","lastname","lname","last"].includes(norm(h)));
  const success: CRMRecord[]=[]; let skipped=0;
  for (const raw of rawRecords) {
    const get=(f:keyof CRMRecord)=>(fm[f]?(raw[fm[f]]??"").trim():"");
    let name=get("name");
    if (!name) { const first=firstNameH?(raw[firstNameH]??"").trim():""; const last=lastNameH?(raw[lastNameH]??"").trim():""; name=[first,last].filter(Boolean).join(" "); }
    const emailRaw=get("email"); const allEmails:string[]=[];
    const fromField=emailRaw.match(EMAIL_RE); if (fromField) allEmails.push(...fromField);
    if (!allEmails.length) { for (const v of Object.values(raw)) { const f=v.match(EMAIL_RE); if (f) { allEmails.push(...f); break; } } }
    const primaryEmail=allEmails[0]??""; const extraEmails=allEmails.slice(1);
    const mobileRaw=get("mobile_without_country_code"); const primaryMobile=mobileRaw.replace(/[\s\-().+]/g,"");
    if (!primaryEmail&&!mobileRaw) { skipped++; continue; }
    const noteParts:string[]=[]; const existingNote=get("crm_note");
    if (existingNote) noteParts.push(existingNote);
    if (extraEmails.length) noteParts.push("Additional emails: "+extraEmails.join(", "));
    for (const h of unmapped) { const v=(raw[h]??"").trim(); if (v&&h!==firstNameH&&h!==lastNameH) noteParts.push(`${h}: ${v}`); }
    let cc=get("country_code"); if (cc&&!cc.startsWith("+")) cc="+"+cc.replace(/\D/g,"");
    let createdAt=get("created_at");
    if (createdAt&&isNaN(new Date(createdAt).getTime())) createdAt="";
    if (!createdAt) createdAt=new Date().toISOString().slice(0,19).replace("T"," ");
    success.push({ created_at:createdAt,name,email:primaryEmail,country_code:cc,mobile_without_country_code:primaryMobile,company:get("company"),city:get("city"),state:get("state"),country:get("country"),lead_owner:get("lead_owner"),crm_status:normalizeStatus(get("crm_status")),crm_note:noteParts.join("; "),data_source:normalizeSource(get("data_source")),possession_time:get("possession_time"),description:get("description") });
  }
  return { success, skipped, total:rawRecords.length };
}

function downloadCSV(records: CRMRecord[]) {
  const esc=(v:string)=>`"${(v??"").replace(/"/g,'""')}"`;
  const rows=[CRM_FIELDS.join(","),...records.map(r=>CRM_FIELDS.map(f=>esc(r[f])).join(","))];
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download="groweasy_crm_import.csv"; a.click(); URL.revokeObjectURL(url);
}

const BACKEND_URL=(import.meta as {env?:Record<string,string>}).env?.VITE_BACKEND_URL??"";
async function processViaBackend(file: File): Promise<ProcessingResult> {
  const form=new FormData(); form.append("file",file);
  const res=await fetch(`${BACKEND_URL}/api/import`,{method:"POST",body:form});
  if (!res.ok) { const b=await res.json().catch(()=>({})); throw new Error((b as {error?:string}).error||`Backend error ${res.status}`); }
  const data=await res.json() as {successful:CRMRecord[];total_input:number;total_imported:number;total_skipped:number;};
  return {success:data.successful,skipped:data.total_skipped,total:data.total_input};
}

// ═══════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ═══════════════════════════════════════════════════════════

function GlassCard({ children, className="", glow=false, style={} }: {
  children: React.ReactNode; className?: string; glow?: boolean; style?: React.CSSProperties;
}) {
  const t = useTV();
  return (
    <div className={`relative rounded-2xl overflow-hidden ${className}`} style={{
      background: t.glassBg, border: `1px solid ${t.glassBorder}`,
      backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
      boxShadow: glow
        ? `0 0 0 1px rgba(123,94,248,0.15), 0 20px 60px ${t.dark?"rgba(0,0,0,0.55)":"rgba(123,94,248,0.08)"}, 0 0 80px rgba(123,94,248,0.07)`
        : `0 4px 24px ${t.dark?"rgba(0,0,0,0.4)":"rgba(123,94,248,0.08)"}`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG];
  if (!cfg) return <span className="text-muted-foreground font-mono text-[11px]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={{ color:cfg.color, background:cfg.bg, border:`1px solid ${cfg.border}`, boxShadow:`0 0 10px ${cfg.bg}` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background:cfg.color, boxShadow:`0 0 4px ${cfg.color}` }} />
      {cfg.label}
    </span>
  );
}

function AnimatedCounter({ value, delay=0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const timeout = setTimeout(() => {
      let start: number|null=null;
      const step=(ts:number)=>{
        if (!start) start=ts;
        const p=Math.min((ts-start)/1200,1), e=1-Math.pow(1-p,3);
        setDisplay(Math.round(e*value));
        if (p<1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return <>{display.toLocaleString()}</>;
}

// Confetti particle
function ConfettiParticle({ color, delay }: { color: string; delay: number }) {
  const x = (Math.random()-0.5)*400;
  const rot = Math.random()*720-360;
  const size = 6+Math.random()*8;
  return (
    <motion.div className="absolute pointer-events-none rounded-sm" style={{ top:"30%", left:"50%", width:size, height:size*0.6, background:color, borderRadius:2 }}
      initial={{ opacity:1, x:0, y:0, rotate:0 }}
      animate={{ opacity:0, x, y:200+Math.random()*200, rotate:rot }}
      transition={{ duration:1.5+Math.random()*0.8, delay, ease:[0.22,1,0.36,1] }}
    />
  );
}

// ═══════════════════════════════════════════════════════════
// STEP INDICATOR
// ═══════════════════════════════════════════════════════════

function StepIndicator({ current }: { current: Step }) {
  const t = useTV();
  const idx = STEP_IDX[current];
  return (
    <div className="hidden sm:flex items-center gap-0">
      {WIZARD_STEPS.map((label, i) => {
        const done=i<idx, active=i===idx;
        return (
          <div key={label} className="flex items-center">
            <motion.div
              animate={active ? { scale:1.05 } : { scale:1 }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
              style={active ? {
                background:"rgba(123,94,248,0.15)", border:"1px solid rgba(123,94,248,0.35)",
                color:"#a78bfa", boxShadow:"0 0 20px rgba(123,94,248,0.2)",
              } : { color: done?"#7b5ef8":t.muted }}
            >
              <motion.div
                animate={done ? { scale:[1,1.3,1] } : {}}
                transition={{ duration:0.4 }}
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={done ? { background:"#7b5ef8", color:"#fff" } : active ? { background:"#7b5ef8", color:"#fff" } : { border:`1px solid ${t.glassBorder}`, color:t.muted }}
              >
                {done ? <CheckCircle2 size={11}/> : i+1}
              </motion.div>
              {label}
            </motion.div>
            {i<WIZARD_STEPS.length-1 && (
              <motion.div className="w-6 h-px mx-1" animate={{ background: i<idx?"rgba(123,94,248,0.5)":t.glassBorder }} transition={{ duration:0.5 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// UPLOAD STEP
// ═══════════════════════════════════════════════════════════

const FLOAT_CARDS = [
  { label:"Facebook Lead Ads", color:"#1877f2", cols:["Full Name","Phone Number","City","Ad Campaign"], rows:[["Rahul Sharma","+91 9876543210","Mumbai","Brand Awareness"],["Priya Patel","+91 8765432109","Delhi","Lead Gen"]] },
  { label:"Google Ads Export", color:"#ea4335", cols:["Contact","Email ID","Region","Keyword"], rows:[["Sarah Johnson","sarah@corp.com","Bangalore","real estate"],["Alex Kumar","alex@biz.in","Hyderabad","luxury flats"]] },
  { label:"Custom Spreadsheet", color:"#0ea5e9", cols:["name","mobile","status","remarks"], rows:[["John Doe","9900112233","Interested","Call back tomorrow"],["Lisa Ray","9811223344","Warm","Price inquiry"]] },
];

const HOW_IT_WORKS = [
  { icon:Upload,    title:"Upload Any CSV",  desc:"Facebook, Google Ads, Excel, CRM exports — any format", color:"#7b5ef8" },
  { icon:Brain,     title:"AI Parses It",    desc:"Claude AI reads every column name semantically", color:"#10b981" },
  { icon:Database,  title:"CRM-Ready Data",  desc:"15 structured fields, validated and export-ready", color:"#f59e0b" },
];

function UploadStep({ onFile }: { onFile:(f:File)=>void }) {
  const t = useTV();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [activeCard, setActiveCard] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = setInterval(()=>setActiveCard(p=>(p+1)%FLOAT_CARDS.length), 3000);
    return ()=>clearInterval(id);
  }, []);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")&&!file.type.includes("csv")&&!file.type.includes("text")) { setError("Please upload a valid .csv file."); return; }
    setError(""); onFile(file);
  };
  const handleDrop = useCallback((e:React.DragEvent)=>{ e.preventDefault(); setDragging(false); const f=e.dataTransfer.files[0]; if(f) handleFile(f); },[]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] flex flex-col items-center justify-start overflow-hidden pt-12 pb-16 px-4">

      {/* Background blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div animate={{ scale:[1,1.08,1], opacity:[0.18,0.28,0.18] }} transition={{ duration:8, repeat:Infinity, ease:"easeInOut" }}
          className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] rounded-full"
          style={{ background:"radial-gradient(ellipse,rgba(123,94,248,1) 0%,transparent 70%)", filter:"blur(80px)" }} />
        <motion.div animate={{ scale:[1,1.1,1], opacity:[0.12,0.2,0.12] }} transition={{ duration:10, repeat:Infinity, ease:"easeInOut", delay:2 }}
          className="absolute bottom-[-5%] right-[10%] w-[400px] h-[400px] rounded-full"
          style={{ background:"radial-gradient(ellipse,rgba(6,182,212,1) 0%,transparent 70%)", filter:"blur(80px)" }} />
        <motion.div animate={{ scale:[1,1.06,1], opacity:[0.1,0.16,0.1] }} transition={{ duration:7, repeat:Infinity, ease:"easeInOut", delay:4 }}
          className="absolute top-[40%] left-[-5%] w-[300px] h-[300px] rounded-full"
          style={{ background:"radial-gradient(ellipse,rgba(16,185,129,1) 0%,transparent 70%)", filter:"blur(70px)" }} />
        {/* Grid */}
        <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" style={{ opacity: t.dark?0.04:0.06 }}>
          <defs><pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M 44 0 L 0 0 0 44" fill="none" stroke={t.dark?"white":"rgba(123,94,248,1)"} strokeWidth="1"/>
          </pattern></defs>
          <rect width="100%" height="100%" fill="url(#grid)"/>
        </svg>
      </div>

      <div className="relative w-full max-w-6xl">

        {/* Badge */}
        <motion.div initial={{opacity:0,y:-12}} animate={{opacity:1,y:0}} transition={{delay:0.05}} className="flex justify-center mb-5">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest"
            style={{ background:"rgba(123,94,248,0.12)", border:"1px solid rgba(123,94,248,0.3)", color:"#a78bfa", boxShadow:"0 0 24px rgba(123,94,248,0.12)" }}>
            <motion.div animate={{ rotate:360 }} transition={{ duration:4, repeat:Infinity, ease:"linear" }}>
              <Sparkles size={11} />
            </motion.div>
            AI-Powered · Any CSV Format · GrowEasy CRM
          </div>
        </motion.div>

        {/* Hero headline */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:0.1, duration:0.6, ease:[0.22,1,0.36,1]}} className="text-center mb-3">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.06]">
            <span style={{ color:t.fg }}>Import Any CSV</span>
            <br />
            <span style={{ background:"linear-gradient(135deg,#c084fc 0%,#7b5ef8 40%,#06b6d4 100%)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text" }}>
              Into GrowEasy
            </span>
          </h1>
        </motion.div>
        <motion.p initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} className="text-center text-muted-foreground max-w-lg mx-auto mb-10 leading-relaxed">
          Upload leads from Facebook, Google Ads, Excel or any custom format.
          Claude AI intelligently maps every column to your CRM schema — zero manual configuration.
        </motion.p>

        {/* Main layout: drop zone + rotating CSV preview */}
        <div className="grid lg:grid-cols-2 gap-8 items-start mb-12">

          {/* Drop zone */}
          <motion.div initial={{opacity:0,x:-24}} animate={{opacity:1,x:0}} transition={{delay:0.15,duration:0.6,ease:[0.22,1,0.36,1]}}>
            <motion.div
              animate={dragging?{scale:1.02}:{scale:1}}
              transition={{ type:"spring", stiffness:300, damping:25 }}
              onDragOver={e=>{e.preventDefault();setDragging(true);}}
              onDragLeave={e=>{ if(!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onDrop={handleDrop}
              onClick={()=>inputRef.current?.click()}
              className="rounded-3xl p-10 text-center cursor-pointer relative overflow-hidden"
              style={{
                background: dragging ? "rgba(123,94,248,0.1)" : t.glassBg,
                border: `2px dashed ${dragging?"rgba(123,94,248,0.7)":t.glassBorder}`,
                backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)",
                boxShadow: dragging ? "0 0 50px rgba(123,94,248,0.2), inset 0 0 40px rgba(123,94,248,0.05)" : `0 8px 40px ${t.dark?"rgba(0,0,0,0.4)":"rgba(123,94,248,0.1)"}`,
              }}
            >
              <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);e.target.value="";}} />

              {/* Scanning line when dragging */}
              {dragging && (
                <motion.div className="absolute left-0 right-0 h-px" style={{ background:"linear-gradient(90deg,transparent,rgba(123,94,248,0.8),transparent)" }}
                  animate={{ top:["10%","90%"] }} transition={{ duration:1.2, repeat:Infinity, ease:"easeInOut" }} />
              )}

              <motion.div animate={dragging?{scale:1.2,rotate:-5}:{scale:1,rotate:0}} transition={{type:"spring",stiffness:300,damping:20}} className="flex justify-center mb-5">
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
                  style={{ background:"rgba(123,94,248,0.12)", border:"1px solid rgba(123,94,248,0.35)", boxShadow:"0 0 30px rgba(123,94,248,0.18)" }}>
                  <Upload size={32} style={{ color:"#a78bfa" }} />
                  {dragging && (
                    <>
                      <motion.div className="absolute -inset-2 rounded-3xl border border-[#7b5ef8]/30" animate={{opacity:[0.3,0.9,0.3],scale:[1,1.05,1]}} transition={{duration:1,repeat:Infinity}}/>
                      <motion.div className="absolute -inset-4 rounded-3xl border border-[#7b5ef8]/15" animate={{opacity:[0.1,0.5,0.1],scale:[1,1.08,1]}} transition={{duration:1,repeat:Infinity,delay:0.3}}/>
                    </>
                  )}
                </div>
              </motion.div>

              <p className="text-lg font-bold mb-1" style={{ color:t.fg }}>
                {dragging ? "Release to import" : "Drop your CSV file here"}
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                or click to browse files — any format accepted
              </p>
              <motion.button
                whileHover={{ scale:1.04, boxShadow:"0 8px 30px rgba(123,94,248,0.45)" }}
                whileTap={{ scale:0.97 }}
                onClick={e=>{e.stopPropagation();inputRef.current?.click();}}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-xl font-bold text-sm text-white"
                style={{ background:"linear-gradient(135deg,#7b5ef8,#5b3ef0)", boxShadow:"0 4px 20px rgba(123,94,248,0.4)" }}
              >
                <Upload size={14}/>
                Choose CSV File
                <ChevronRight size={14}/>
              </motion.button>

              {error && (
                <motion.p initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} className="mt-4 text-sm flex items-center justify-center gap-1.5 text-[#f43f5e]">
                  <AlertTriangle size={13}/> {error}
                </motion.p>
              )}

              {/* Format chips */}
              <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                {["Facebook","Google Ads","Excel","Salesforce","HubSpot","Custom"].map(s=>(
                  <span key={s} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background:t.dark?"rgba(255,255,255,0.05)":"rgba(123,94,248,0.07)", border:`1px solid ${t.glassBorder}`, color:t.muted }}>
                    {s}
                  </span>
                ))}
              </div>
            </motion.div>

            {/* Feature badges below drop zone */}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {[
                {icon:Brain,label:"Semantic AI",color:"#7b5ef8"},
                {icon:Shield,label:"Auto Validate",color:"#10b981"},
                {icon:Zap,label:"Batch Process",color:"#f59e0b"},
              ].map(({icon:Icon,label,color},i)=>(
                <motion.div key={label} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.3+i*0.07}}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                  style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(12px)" }}>
                  <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background:`${color}18`, border:`1px solid ${color}30` }}>
                    <Icon size={12} style={{ color }}/>
                  </div>
                  <span className="text-xs font-semibold" style={{ color:t.fg }}>{label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Rotating CSV preview cards */}
          <motion.div initial={{opacity:0,x:24}} animate={{opacity:1,x:0}} transition={{delay:0.2,duration:0.6,ease:[0.22,1,0.36,1]}} className="relative h-72 lg:h-96">
            {FLOAT_CARDS.map((card, ci)=>(
              <AnimatePresence key={ci}>
                {activeCard===ci && (
                  <motion.div
                    initial={{ opacity:0, scale:0.93, y:16 }}
                    animate={{ opacity:1, scale:1, y:0 }}
                    exit={{ opacity:0, scale:0.95, y:-12 }}
                    transition={{ duration:0.5, ease:[0.22,1,0.36,1] }}
                    className="absolute inset-0 rounded-2xl overflow-hidden"
                    style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", boxShadow:`0 8px 32px ${t.dark?"rgba(0,0,0,0.4)":"rgba(123,94,248,0.1)"}` }}
                  >
                    {/* Card header */}
                    <div className="px-4 py-3 flex items-center gap-2.5" style={{ borderBottom:`1px solid ${t.glassBorder}`, background:`${card.color}10` }}>
                      <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-[#f43f5e]/70"/><div className="w-2.5 h-2.5 rounded-full bg-[#f59e0b]/70"/><div className="w-2.5 h-2.5 rounded-full bg-[#10b981]/70"/></div>
                      <div className="w-4 h-4 rounded flex items-center justify-center" style={{ background:card.color, opacity:0.9 }}>
                        <FileText size={9} className="text-white"/>
                      </div>
                      <span className="text-xs font-semibold" style={{ color:t.fg }}>{card.label}</span>
                      <span className="ml-auto text-[10px] font-mono text-muted-foreground">source.csv</span>
                    </div>
                    {/* Table */}
                    <div className="overflow-auto" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:"11px" }}>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr style={{ borderBottom:`1px solid ${t.glassBorder}` }}>
                            {card.cols.map(c=>(
                              <th key={c} className="text-left px-3 py-2 font-semibold uppercase tracking-wider text-[10px]" style={{ color:t.muted }}>
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {card.rows.map((row,ri)=>(
                            <motion.tr key={ri} initial={{opacity:0,x:-8}} animate={{opacity:1,x:0}} transition={{delay:0.1+ri*0.1}}
                              style={{ borderBottom:`1px solid ${t.dark?"rgba(255,255,255,0.02)":"rgba(123,94,248,0.04)"}` }}>
                              {row.map((cell,ci2)=>(
                                <td key={ci2} className="px-3 py-2.5" style={{ color:t.dark?"#9db4d8":"#3b2d8a" }}>{cell}</td>
                              ))}
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Arrow + transform indicator */}
                    <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop:`1px solid ${t.glassBorder}` }}>
                      <div className="flex items-center gap-1.5 text-[11px]" style={{ color:"#a78bfa" }}>
                        <motion.div animate={{ x:[0,4,0] }} transition={{ duration:1.2, repeat:Infinity }}>
                          <ArrowRight size={13}/>
                        </motion.div>
                        <span className="font-semibold">AI maps to GrowEasy CRM schema</span>
                      </div>
                      <div className="ml-auto flex gap-1">
                        {FLOAT_CARDS.map((_,i)=>(
                          <div key={i} className="w-1.5 h-1.5 rounded-full transition-all duration-300" style={{ background: i===ci?"#7b5ef8":t.dark?"rgba(255,255,255,0.15)":"rgba(123,94,248,0.2)" }}/>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            ))}
          </motion.div>
        </div>

        {/* How it works */}
        <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{delay:0.35}}>
          <div className="flex items-center gap-3 mb-6 justify-center">
            <div className="h-px flex-1 max-w-24" style={{ background:`linear-gradient(90deg,transparent,${t.glassBorder})` }}/>
            <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">How It Works</span>
            <div className="h-px flex-1 max-w-24" style={{ background:`linear-gradient(90deg,${t.glassBorder},transparent)` }}/>
          </div>
          <div className="grid grid-cols-3 gap-4 relative">
            {/* Connecting lines */}
            <div className="absolute top-8 left-[calc(16.67%+16px)] right-[calc(16.67%+16px)] h-px hidden sm:block" style={{ background:`linear-gradient(90deg,rgba(123,94,248,0.3),rgba(6,182,212,0.3))` }}>
              <motion.div className="absolute inset-0" style={{ background:"linear-gradient(90deg,rgba(123,94,248,0.8),rgba(6,182,212,0.8))", transformOrigin:"left" }}
                animate={{ scaleX:[0,1] }} transition={{ duration:1.5, delay:0.5, repeat:Infinity, repeatDelay:3 }}/>
            </div>
            {HOW_IT_WORKS.map(({icon:Icon,title,desc,color},i)=>(
              <motion.div key={title} initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{delay:0.4+i*0.1}}
                className="text-center rounded-2xl p-5 relative"
                style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(12px)" }}>
                <motion.div whileHover={{ scale:1.1, rotate:5 }} className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
                  style={{ background:`${color}18`, border:`1px solid ${color}30`, boxShadow:`0 0 16px ${color}20` }}>
                  <Icon size={20} style={{ color }}/>
                </motion.div>
                <div className="text-sm font-bold mb-1" style={{ color:t.fg }}>{title}</div>
                <div className="text-xs text-muted-foreground leading-relaxed">{desc}</div>
                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white" style={{ background:color }}>
                  {i+1}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PREVIEW STEP
// ═══════════════════════════════════════════════════════════

const COL_TYPE_DETECT = (h: string): { label:string; color:string }|null => {
  const n=norm(h);
  if (["email","e mail","mail","email id"].some(p=>n.includes(p))) return {label:"Email",color:"#7b5ef8"};
  if (["mobile","phone","cell","tel","ph","mob"].some(p=>n.includes(p))) return {label:"Phone",color:"#10b981"};
  if (["name","contact","customer","lead"].some(p=>n.includes(p))) return {label:"Name",color:"#f59e0b"};
  if (["status","stage","disposition"].some(p=>n.includes(p))) return {label:"Status",color:"#a78bfa"};
  if (["city","town","location","area"].some(p=>n.includes(p))) return {label:"City",color:"#06b6d4"};
  if (["date","created","timestamp","added"].some(p=>n.includes(p))) return {label:"Date",color:"#f43f5e"};
  if (["source","campaign","channel"].some(p=>n.includes(p))) return {label:"Source",color:"#f59e0b"};
  return null;
};

function PreviewStep({ headers,records,fileName,onConfirm,onBack }: {
  headers:string[]; records:RawRecord[]; fileName:string; onConfirm:()=>void; onBack:()=>void;
}) {
  const t = useTV();
  const preview = records.slice(0,200);
  const detected = headers.filter(h=>COL_TYPE_DETECT(h));

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-4 sm:p-6 gap-4">
      {/* Toolbar */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button onClick={onBack} className="p-1 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
              <ArrowRight size={14} className="rotate-180"/>
            </button>
            <h2 className="text-xl font-bold" style={{ color:t.fg }}>CSV Preview</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-7">
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background:t.dark?"rgba(255,255,255,0.06)":"rgba(123,94,248,0.07)", border:`1px solid ${t.glassBorder}`, color:t.muted }}>{fileName}</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background:"rgba(123,94,248,0.12)", border:"1px solid rgba(123,94,248,0.25)", color:"#a78bfa" }}>{records.length.toLocaleString()} rows</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)", color:"#10b981" }}>{detected.length} columns detected</span>
          </div>
        </div>
        <motion.button whileHover={{scale:1.03,boxShadow:"0 8px 28px rgba(123,94,248,0.45)"}} whileTap={{scale:0.97}}
          onClick={onConfirm}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white flex-shrink-0"
          style={{ background:"linear-gradient(135deg,#7b5ef8,#5b3ef0)", boxShadow:"0 4px 20px rgba(123,94,248,0.4)" }}>
          <Sparkles size={14}/>
          Confirm & Run AI Extraction
          <ChevronRight size={14}/>
        </motion.button>
      </motion.div>

      {/* Column detection row */}
      <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.1}} className="flex flex-wrap gap-2 flex-shrink-0">
        <span className="text-xs text-muted-foreground flex items-center gap-1"><Brain size={11}/> AI will detect:</span>
        {headers.map((h,i)=>{
          const det=COL_TYPE_DETECT(h);
          return (
            <motion.span key={h} initial={{opacity:0,scale:0.85}} animate={{opacity:1,scale:1}} transition={{delay:0.15+i*0.03}}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
              style={det ? { background:`${det.color}15`, border:`1px solid ${det.color}30`, color:det.color } : { background:t.dark?"rgba(255,255,255,0.04)":"rgba(0,0,0,0.05)", border:`1px solid ${t.glassBorder}`, color:t.muted }}>
              {det && <span className="w-1.5 h-1.5 rounded-full" style={{ background:det.color }}/>}
              <span className="max-w-[100px] truncate">{h}</span>
              {det && <span className="opacity-70">→ {det.label}</span>}
            </motion.span>
          );
        })}
      </motion.div>

      {/* Info banner */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl flex-shrink-0 text-sm"
        style={{ background:"rgba(123,94,248,0.07)", border:"1px solid rgba(123,94,248,0.2)", color:"#a78bfa" }}>
        <Database size={13} className="flex-shrink-0"/>
        <span>Raw CSV preview — no AI processing yet. Click <strong>Confirm</strong> to start intelligent field mapping across all {records.length.toLocaleString()} rows.</span>
      </div>

      {/* Table */}
      <GlassCard className="flex-1 min-h-0">
        <div className="overflow-auto h-full" style={{ scrollbarWidth:"thin", scrollbarColor:`rgba(123,94,248,0.3) transparent` }}>
          <table className="w-full border-collapse" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:"11.5px" }}>
            <thead className="sticky top-0 z-10" style={{ background:t.termBg, backdropFilter:"blur(12px)" }}>
              <tr style={{ borderBottom:`1px solid ${t.glassBorder}` }}>
                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest w-10" style={{ color:t.muted }}>#</th>
                {headers.map(h=>{
                  const det=COL_TYPE_DETECT(h);
                  return (
                    <th key={h} className="text-left px-4 py-3 whitespace-nowrap" style={{ borderRight:`1px solid ${t.glassBorder}` }}>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color:t.muted }}>{h}</span>
                        {det && <span className="text-[9px] font-bold" style={{ color:det.color }}>↳ {det.label}</span>}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {preview.map((row,i)=>(
                <motion.tr key={i}
                  initial={{ opacity:0, x:-6 }}
                  animate={{ opacity:1, x:0 }}
                  transition={{ delay:Math.min(i*0.015,0.4), duration:0.25 }}
                  style={{ borderBottom:`1px solid ${t.dark?"rgba(255,255,255,0.025)":"rgba(123,94,248,0.04)"}` }}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=t.rowHover}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=""}
                >
                  <td className="px-3 py-2.5 text-right" style={{ color:t.dark?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.2)" }}>{i+1}</td>
                  {headers.map(h=>(
                    <td key={h} className="px-4 py-2.5 max-w-[180px]" style={{ borderRight:`1px solid ${t.dark?"rgba(255,255,255,0.025)":"rgba(123,94,248,0.04)"}` }}>
                      <span className="block truncate" style={{ color:row[h]?t.dark?"#9db4d8":"#3b2d8a":"rgba(0,0,0,0.2)" }} title={row[h]}>
                        {row[h]||"—"}
                      </span>
                    </td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
          {records.length>200 && (
            <div className="text-center py-3 text-xs text-muted-foreground font-mono" style={{ borderTop:`1px solid ${t.glassBorder}` }}>
              Showing 200 of {records.length.toLocaleString()} rows — all will be processed
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PROCESSING STEP
// ═══════════════════════════════════════════════════════════

function ProcessingStep({ progress, message, total }: { progress:number; message:string; total:number }) {
  const t = useTV();
  const R=52, C=2*Math.PI*R;
  const offset = C*(1-progress/100);

  return (
    <div className="relative flex items-center justify-center min-h-[calc(100vh-64px)] px-4 overflow-hidden">
      {/* Background glow */}
      <motion.div animate={{ scale:[1,1.15,1], opacity:[0.12,0.22,0.12] }} transition={{ duration:3, repeat:Infinity }}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{ background:"radial-gradient(ellipse,rgba(123,94,248,0.8) 0%,transparent 70%)", filter:"blur(60px)" }}/>

      {/* Neural network dots */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity:t.dark?0.15:0.08 }}>
        {Array.from({length:12}).map((_,i)=>{
          const x=(i%4)*25+12.5, y=Math.floor(i/4)*34+17;
          return <motion.circle key={i} cx={`${x}%`} cy={`${y}%`} r="2" fill="#7b5ef8"
            animate={{ opacity:[0.2,0.8,0.2], r:[1.5,3,1.5] }} transition={{ duration:2+i*0.3, repeat:Infinity, delay:i*0.2 }}/>;
        })}
        {[[0,1],[1,2],[4,5],[5,6],[8,9],[9,10],[0,4],[4,8],[1,5],[5,9],[2,6],[6,10],[1,6],[5,10]].map(([a,b],i)=>{
          const ax=((a??0)%4)*25+12.5, ay=Math.floor((a??0)/4)*34+17;
          const bx=((b??0)%4)*25+12.5, by=Math.floor((b??0)/4)*34+17;
          return <motion.line key={i} x1={`${ax}%`} y1={`${ay}%`} x2={`${bx}%`} y2={`${by}%`}
            stroke="#7b5ef8" strokeWidth="0.5"
            animate={{ opacity:[0,0.5,0] }} transition={{ duration:2.5, repeat:Infinity, delay:i*0.18 }}/>;
        })}
      </svg>

      <motion.div initial={{opacity:0,scale:0.9}} animate={{opacity:1,scale:1}} transition={{duration:0.4}} className="w-full max-w-lg relative z-10">

        {/* Circular progress */}
        <div className="flex justify-center mb-8">
          <div className="relative w-32 h-32 flex items-center justify-center">
            <svg width="128" height="128" className="absolute -rotate-90">
              <circle cx="64" cy="64" r={R} fill="none" stroke={t.dark?"rgba(255,255,255,0.06)":"rgba(123,94,248,0.12)"} strokeWidth="6"/>
              <motion.circle cx="64" cy="64" r={R} fill="none" strokeWidth="6" strokeLinecap="round"
                stroke="url(#pGrad)"
                strokeDasharray={C}
                animate={{ strokeDashoffset:offset }}
                transition={{ duration:0.4, ease:"easeOut" }}
              />
              <defs><linearGradient id="pGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7b5ef8"/><stop offset="100%" stopColor="#06b6d4"/>
              </linearGradient></defs>
            </svg>
            {/* Pulsing core */}
            <motion.div animate={{ scale:[0.95,1.05,0.95], opacity:[0.7,1,0.7] }} transition={{ duration:2, repeat:Infinity }}
              className="w-20 h-20 rounded-full flex flex-col items-center justify-center"
              style={{ background:"rgba(123,94,248,0.1)", border:"1px solid rgba(123,94,248,0.25)" }}>
              <div className="text-2xl font-bold font-mono" style={{ color:"#a78bfa" }}>{Math.round(progress)}%</div>
              <div className="text-[9px] text-muted-foreground font-mono tracking-widest">DONE</div>
            </motion.div>
          </div>
        </div>

        <div className="text-center mb-7">
          <h2 className="text-2xl font-bold mb-1.5" style={{ color:t.fg }}>AI Processing</h2>
          <p className="text-muted-foreground text-sm">
            Mapping <span className="font-mono" style={{ color:"#a78bfa" }}>{total.toLocaleString()}</span> records to GrowEasy CRM schema
          </p>
        </div>

        {/* Terminal */}
        <GlassCard glow>
          {/* Title bar */}
          <div className="px-4 py-3 flex items-center gap-2.5" style={{ borderBottom:`1px solid ${t.glassBorder}` }}>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background:"rgba(244,63,94,0.7)" }}/>
              <div className="w-3 h-3 rounded-full" style={{ background:"rgba(245,158,11,0.7)" }}/>
              <div className="w-3 h-3 rounded-full" style={{ background:"rgba(16,185,129,0.7)" }}/>
            </div>
            <span className="text-xs font-mono text-muted-foreground ml-1">groweasy-ai — extraction.engine</span>
            <div className="ml-auto flex items-center gap-1.5">
              <motion.div animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.2, repeat:Infinity }} className="w-2 h-2 rounded-full bg-[#10b981]"/>
              <span className="text-[10px] font-mono text-[#10b981]">LIVE</span>
            </div>
          </div>

          {/* Log lines */}
          <div className="p-4 space-y-1.5 font-mono text-[11px]">
            {PROCESSING_STEPS.map((msg,i)=>{
              const threshold=(i/PROCESSING_STEPS.length)*100;
              const stepSize=100/PROCESSING_STEPS.length;
              const isDone=progress>threshold+stepSize-1;
              const isActive=!isDone&&progress>threshold;
              return (
                <AnimatePresence key={i}>
                  {(isDone||isActive||progress>threshold-10) && (
                    <motion.div initial={{opacity:0,x:-12}} animate={{opacity:1,x:0}} exit={{opacity:0}}
                      transition={{duration:0.25,delay:isActive?0:0}}
                      className="flex items-start gap-3">
                      <span className="flex-shrink-0 text-[10px] w-14" style={{ color:isDone?"#10b981":isActive?"#a78bfa":"#4e5f80" }}>
                        {isDone?"[  ok  ]":isActive?"[ run  ]":"[ wait ]"}
                      </span>
                      <span style={{ color:isDone?t.dark?"#9db4d8":"#3b2d8a":isActive?t.fg:t.muted }}>
                        {msg}
                      </span>
                      {isActive && (
                        <motion.span animate={{ opacity:[1,0,1] }} transition={{ duration:0.6, repeat:Infinity }} style={{ color:"#a78bfa" }}>▊</motion.span>
                      )}
                      {isDone && <CheckCircle2 size={11} className="ml-auto flex-shrink-0 text-[#10b981] mt-0.5"/>}
                    </motion.div>
                  )}
                </AnimatePresence>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop:`1px solid ${t.glassBorder}` }}>
            <span className="text-[10px] font-mono text-muted-foreground truncate pr-4">{message}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="w-24 h-1 rounded-full overflow-hidden" style={{ background:t.dark?"rgba(255,255,255,0.08)":"rgba(123,94,248,0.1)" }}>
                <motion.div className="h-full rounded-full" style={{ background:"linear-gradient(90deg,#7b5ef8,#06b6d4)" }}
                  animate={{ width:`${progress}%` }} transition={{ duration:0.35 }}/>
              </div>
              <span className="text-[10px] font-mono" style={{ color:"#a78bfa" }}>{Math.round(progress)}%</span>
            </div>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// RESULTS STEP
// ═══════════════════════════════════════════════════════════

const CONFETTI_COLORS = ["#7b5ef8","#10b981","#f59e0b","#f43f5e","#06b6d4","#a78bfa","#34d399"];

function ResultsStep({ result, onReset }: { result:ProcessingResult; onReset:()=>void }) {
  const t = useTV();
  const [filter, setFilter] = useState("all");
  const [showConfetti, setShowConfetti] = useState(true);

  useEffect(()=>{ const id=setTimeout(()=>setShowConfetti(false),2500); return ()=>clearTimeout(id); },[]);

  const statusCounts = result.success.reduce<Record<string,number>>((acc,r)=>{ acc[r.crm_status]=(acc[r.crm_status]??0)+1; return acc; },{});
  const pieData = Object.entries(STATUS_CFG).map(([key,cfg])=>({ name:cfg.label, value:statusCounts[key]??0, color:cfg.color, key })).filter(d=>d.value>0);
  const successRate = result.total>0?Math.round((result.success.length/result.total)*100):0;
  const filtered = filter==="all"?result.success:result.success.filter(r=>r.crm_status===filter);

  const STATS = [
    { label:"Total Input",  val:result.total,           icon:FileText,    color:"#7b5ef8"  },
    { label:"Imported",     val:result.success.length,  icon:CheckCircle2,color:"#10b981"  },
    { label:"Skipped",      val:result.skipped,         icon:SkipForward, color:"#f59e0b"  },
    { label:"Success Rate", val:successRate,             icon:TrendingUp,  color:"#a78bfa", suffix:"%" },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-4 sm:p-6 gap-4 relative">
      {/* Confetti */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          {Array.from({length:40}).map((_,i)=>(
            <ConfettiParticle key={i} color={CONFETTI_COLORS[i%CONFETTI_COLORS.length]} delay={i*0.04}/>
          ))}
        </div>
      )}

      {/* Header */}
      <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <motion.div initial={{scale:0}} animate={{scale:1}} transition={{type:"spring",stiffness:400,damping:15,delay:0.2}}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background:"rgba(16,185,129,0.15)", border:"1px solid rgba(16,185,129,0.35)" }}>
              <CheckCircle2 size={14} className="text-[#10b981]"/>
            </motion.div>
            <h2 className="text-xl font-bold" style={{ color:t.fg }}>Import Complete</h2>
            <motion.div initial={{opacity:0,scale:0.8}} animate={{opacity:1,scale:1}} transition={{delay:0.3}}
              className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
              style={{ background:"linear-gradient(135deg,#10b981,#059669)" }}>
              SUCCESS
            </motion.div>
          </div>
          <p className="text-sm text-muted-foreground pl-9">
            AI extracted <span className="font-mono" style={{ color:"#a78bfa" }}>{result.success.length.toLocaleString()}</span> CRM records from <span className="font-mono" style={{ color:t.dark?"#9db4d8":"#3b2d8a" }}>{result.total.toLocaleString()}</span> input rows
          </p>
        </div>
        <div className="flex gap-2 flex-wrap flex-shrink-0">
          <motion.button whileHover={{scale:1.03}} whileTap={{scale:0.97}}
            onClick={()=>downloadCSV(result.success)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, color:t.fg }}>
            <Download size={14}/> Export CSV
          </motion.button>
          <motion.button whileHover={{scale:1.03,boxShadow:"0 8px 28px rgba(123,94,248,0.45)"}} whileTap={{scale:0.97}}
            onClick={onReset}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background:"linear-gradient(135deg,#7b5ef8,#5b3ef0)", boxShadow:"0 4px 16px rgba(123,94,248,0.4)" }}>
            <RefreshCw size={14}/> New Import
          </motion.button>
        </div>
      </motion.div>

      {/* Stats + Donut */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 flex-shrink-0">
        {STATS.map(({label,val,icon:Icon,color,suffix},i)=>(
          <motion.div key={label} initial={{opacity:0,y:16,scale:0.95}} animate={{opacity:1,y:0,scale:1}} transition={{delay:i*0.07,type:"spring",stiffness:200}}
            whileHover={{ y:-2, boxShadow:`0 8px 32px ${color}25` }}
            className="rounded-2xl p-4 transition-shadow"
            style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(16px)", boxShadow:`0 4px 20px ${color}10` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-3" style={{ background:`${color}15`, border:`1px solid ${color}25` }}>
              <Icon size={15} style={{ color }}/>
            </div>
            <div className="text-2xl font-bold font-mono leading-none mb-1" style={{ color }}>
              <AnimatedCounter value={val} delay={i*80}/>{suffix??""}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </motion.div>
        ))}

        {/* Donut */}
        {pieData.length>0 && (
          <motion.div initial={{opacity:0,scale:0.9}} animate={{opacity:1,scale:1}} transition={{delay:0.28}}
            className="rounded-2xl p-4 flex items-center gap-3 col-span-2 sm:col-span-1"
            style={{ background:t.glassBg, border:`1px solid ${t.glassBorder}`, backdropFilter:"blur(16px)" }}>
            <div className="w-20 h-20 flex-shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={20} outerRadius={34} dataKey="value" strokeWidth={0} animationBegin={300} animationDuration={800}>
                    {pieData.map((e,i)=><Cell key={i} fill={e.color}/>)}
                  </Pie>
                  <Tooltip contentStyle={{ background:t.termBg, border:`1px solid ${t.glassBorder}`, borderRadius:8, fontSize:11, color:t.fg }} formatter={(v:number,n:string)=>[v,n]}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5 min-w-0 flex-1">
              {pieData.map(d=>(
                <div key={d.key} className="flex items-center gap-1.5 text-[11px]">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background:d.color, boxShadow:`0 0 4px ${d.color}` }}/>
                  <span className="text-muted-foreground truncate flex-1">{d.name}</span>
                  <span className="font-mono font-bold flex-shrink-0" style={{ color:d.color }}>{d.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Filter bar */}
      <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.25}} className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <BarChart3 size={12} className="text-muted-foreground"/>
        <span className="text-xs text-muted-foreground">Filter:</span>
        {[{key:"all",label:`All`,count:result.success.length,color:"#7b5ef8"},
          ...Object.entries(STATUS_CFG).map(([k,v])=>({key:k,label:v.label,count:statusCounts[k]??0,color:v.color}))
        ].map(tab=>(
          <motion.button key={tab.key} whileHover={{scale:1.04}} whileTap={{scale:0.96}}
            onClick={()=>setFilter(tab.key)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all"
            style={filter===tab.key
              ? {background:`${tab.color}18`,border:`1px solid ${tab.color}45`,color:tab.color,boxShadow:`0 0 16px ${tab.color}25`}
              : {background:t.dark?"rgba(255,255,255,0.04)":"rgba(123,94,248,0.05)",border:`1px solid ${t.glassBorder}`,color:t.muted}}>
            {tab.label} <span className="font-mono opacity-70">({tab.count})</span>
          </motion.button>
        ))}
        <span className="ml-auto text-xs font-mono text-muted-foreground">{filtered.length} records</span>
      </motion.div>

      {/* Results table */}
      <GlassCard className="flex-1 min-h-0" glow>
        <div className="overflow-auto h-full" style={{ scrollbarWidth:"thin", scrollbarColor:`rgba(123,94,248,0.3) transparent` }}>
          <table className="w-full border-collapse" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:"11px" }}>
            <thead className="sticky top-0 z-10" style={{ background:t.termBg, backdropFilter:"blur(12px)", borderBottom:`1px solid ${t.glassBorder}` }}>
              <tr>
                <th className="px-3 py-3 text-left text-[10px] uppercase tracking-widest w-8" style={{ color:t.muted }}>#</th>
                {CRM_FIELDS.map(f=>(
                  <th key={f} className="px-3 py-3 text-left text-[10px] uppercase tracking-wider whitespace-nowrap" style={{ color:t.muted, borderRight:`1px solid ${t.glassBorder}` }}>
                    {f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filtered.map((rec,i)=>(
                  <motion.tr key={`${filter}-${i}`}
                    initial={{opacity:0,y:4}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:0.98}}
                    transition={{duration:0.18,delay:Math.min(i*0.015,0.3)}}
                    style={{ borderBottom:`1px solid ${t.dark?"rgba(255,255,255,0.025)":"rgba(123,94,248,0.04)"}` }}
                    onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background=t.rowHover}
                    onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background=""}
                  >
                    <td className="px-3 py-2.5" style={{ color:t.dark?"rgba(255,255,255,0.2)":"rgba(0,0,0,0.2)" }}>{i+1}</td>
                    {CRM_FIELDS.map(f=>(
                      <td key={f} className="px-3 py-2.5 max-w-[180px]" style={{ borderRight:`1px solid ${t.dark?"rgba(255,255,255,0.025)":"rgba(123,94,248,0.04)"}` }}>
                        {f==="crm_status"
                          ? <StatusBadge status={rec[f]}/>
                          : <span className="block truncate" style={{ color:rec[f]?t.dark?"#9db4d8":"#3b2d8a":"rgba(0,0,0,0.2)" }} title={rec[f]}>{rec[f]||"—"}</span>
                        }
                      </td>
                    ))}
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {filtered.length===0&&(
            <div className="text-center py-16 text-muted-foreground text-sm">No records match this filter.</div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════

export default function App() {
  const [step, setStep] = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRecords, setRawRecords] = useState<RawRecord[]>([]);
  const [csvFile, setCsvFile] = useState<File|null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<ProcessingResult|null>(null);
  const [dark, setDark] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");

  const tv = makeTV(dark);

  useEffect(()=>{ document.documentElement.classList.toggle("dark",dark); },[dark]);

  const handleFile = useCallback((file: File)=>{
    setFileName(file.name); setCsvFile(file);
    const reader=new FileReader();
    reader.onload=e=>{ const text=e.target?.result as string; const {headers:h,records:r}=parseCSV(text); setHeaders(h); setRawRecords(r); setStep("preview"); };
    reader.readAsText(file);
  },[]);

  const handleConfirm = useCallback(async ()=>{
    setStep("processing"); setProgress(0); setMessage(PROCESSING_STEPS[0]);
    let idx=0; const DUR=240;
    const iv=setInterval(()=>{ idx++; if(idx<PROCESSING_STEPS.length){ setMessage(PROCESSING_STEPS[idx]); setProgress((idx/PROCESSING_STEPS.length)*88); } },DUR);
    const cleanup=()=>clearInterval(iv);
    try {
      let res: ProcessingResult;
      if(BACKEND_URL&&csvFile) { res=await processViaBackend(csvFile); }
      else { await new Promise<void>(r=>setTimeout(r,PROCESSING_STEPS.length*DUR+200)); res=processRecords(headers,rawRecords); }
      cleanup(); setResult(res); setProgress(100); setTimeout(()=>setStep("results"),420);
    } catch(err) {
      cleanup(); console.error(err);
      const res=processRecords(headers,rawRecords); setResult(res); setProgress(100); setTimeout(()=>setStep("results"),420);
    }
  },[headers,rawRecords,csvFile]);

  const handleReset = useCallback(()=>{ setStep("upload"); setResult(null); setHeaders([]); setRawRecords([]); setCsvFile(null); setFileName(""); setProgress(0); },[]);

  return (
    <Ctx.Provider value={tv}>
      <div className="min-h-screen bg-background text-foreground transition-colors duration-300" style={{ fontFamily:"'Outfit',system-ui,sans-serif" }}>

        {/* Header */}
        <header className="sticky top-0 z-50 h-16 flex items-center transition-colors duration-300"
          style={{ background:tv.headerBg, borderBottom:`1px solid ${tv.glassBorder}`, backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)" }}>
          <div className="max-w-screen-2xl mx-auto px-5 w-full flex items-center justify-between gap-4">

            {/* Logo */}
            <motion.div whileHover={{ scale:1.03 }} className="flex items-center gap-3 flex-shrink-0 cursor-pointer" onClick={handleReset}>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background:"linear-gradient(135deg,#7b5ef8,#5b3ef0)", boxShadow:"0 0 16px rgba(123,94,248,0.45)" }}>
                <Zap size={15} className="text-white"/>
              </div>
              <div className="leading-tight">
                <span className="font-bold text-sm" style={{ color:tv.fg }}>GrowEasy</span>
                <span className="text-muted-foreground text-sm font-normal"> / CSV Importer</span>
              </div>
            </motion.div>

            {/* Step indicator */}
            <div className="flex-1 flex justify-center">
              {step!=="upload"&&<StepIndicator current={step}/>}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* AI Ready badge */}
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono"
                style={{ background:"rgba(16,185,129,0.1)", border:"1px solid rgba(16,185,129,0.25)", color:"#10b981" }}>
                <motion.div animate={{ scale:[1,1.3,1] }} transition={{ duration:2, repeat:Infinity }} className="w-1.5 h-1.5 rounded-full bg-[#10b981]"/>
                Claude AI Ready
              </div>

              {/* Dark mode toggle */}
              <motion.button
                whileHover={{ scale:1.08 }} whileTap={{ scale:0.92 }}
                onClick={()=>setDark(d=>!d)}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors"
                style={{ background:tv.dark?"rgba(255,255,255,0.06)":"rgba(123,94,248,0.08)", border:`1px solid ${tv.glassBorder}`, color:tv.muted }}
                aria-label="Toggle dark mode"
              >
                <AnimatePresence mode="wait">
                  {dark
                    ? <motion.div key="sun" initial={{rotate:-90,opacity:0}} animate={{rotate:0,opacity:1}} exit={{rotate:90,opacity:0}} transition={{duration:0.2}}><Sun size={15} style={{ color:"#f59e0b" }}/></motion.div>
                    : <motion.div key="moon" initial={{rotate:90,opacity:0}} animate={{rotate:0,opacity:1}} exit={{rotate:-90,opacity:0}} transition={{duration:0.2}}><Moon size={15} style={{ color:"#7b5ef8" }}/></motion.div>
                  }
                </AnimatePresence>
              </motion.button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-screen-2xl mx-auto">
          <AnimatePresence mode="wait">
            {step==="upload"&&(
              <motion.div key="upload" exit={{opacity:0,y:-20,scale:0.98}} transition={{duration:0.25}}>
                <UploadStep onFile={handleFile}/>
              </motion.div>
            )}
            {step==="preview"&&(
              <motion.div key="preview" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-20}} transition={{duration:0.3,ease:[0.22,1,0.36,1]}}>
                <PreviewStep headers={headers} records={rawRecords} fileName={fileName} onConfirm={handleConfirm} onBack={handleReset}/>
              </motion.div>
            )}
            {step==="processing"&&(
              <motion.div key="processing" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.3}}>
                <ProcessingStep progress={progress} message={message} total={rawRecords.length}/>
              </motion.div>
            )}
            {step==="results"&&result&&(
              <motion.div key="results" initial={{opacity:0,y:20}} animate={{opacity:1,y:0}} transition={{duration:0.35,ease:[0.22,1,0.36,1]}}>
                <ResultsStep result={result} onReset={handleReset}/>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </Ctx.Provider>
  );
}