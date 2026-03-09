import { useState, useRef, useCallback, useEffect } from "react";

// ═══════════════════════════════════════════════════════
//  CONSTANTS & THEME
// ═══════════════════════════════════════════════════════
const C = {
  bg: "#06080f", surface: "#0b0f1a", card: "#0e1220",
  cardHover: "#111728", border: "rgba(255,255,255,0.06)",
  green: "#00e676", yellow: "#ffd600", red: "#ff1744",
  blue: "#40c4ff", purple: "#ce93d8", orange: "#ffab40",
  text: "#e8edf5", muted: "rgba(255,255,255,0.42)", dim: "rgba(255,255,255,0.12)",
};

// ═══════════════════════════════════════════════════════
//  CSV PARSER
// ═══════════════════════════════════════════════════════
const parseCSV = (text) => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
};

// ═══════════════════════════════════════════════════════
//  COLUMN MAPPERS  (fuzzy match)
// ═══════════════════════════════════════════════════════
const fuzzy = (row, keywords) => {
  const key = Object.keys(row).find(k =>
    keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase()))
  );
  return key ? row[key] : null;
};

const mapCatapult = (row) => ({
  jugador:     fuzzy(row, ["player name","athlete","jugador","nombre"]) || "—",
  fecha:       fuzzy(row, ["date","fecha"]) || "—",
  distancia:   parseFloat(fuzzy(row, ["total distance","distancia total","distance"]) || 0),
  hsr:         parseFloat(fuzzy(row, ["high speed","hsr","alta velocidad"]) || 0),
  sprint:      parseFloat(fuzzy(row, ["sprint distance","sprint"]) || 0),
  acels:       parseFloat(fuzzy(row, ["acceleration","acel"]) || 0),
  decels:      parseFloat(fuzzy(row, ["deceleration","decel"]) || 0),
  playerLoad:  parseFloat(fuzzy(row, ["player load","carga"]) || 0),
  velMax:      parseFloat(fuzzy(row, ["max velocity","vel max","velocidad"]) || 0),
});

const mapWyscout = (row) => ({
  jugador:     fuzzy(row, ["player","jugador","nombre"]) || "—",
  partido:     fuzzy(row, ["match","partido"]) || "—",
  fecha:       fuzzy(row, ["date","fecha"]) || "—",
  minutos:     parseFloat(fuzzy(row, ["minutes","minutos","mins"]) || 0),
  pasesPct:    parseFloat(fuzzy(row, ["passes accurate","pases"]) || 0),
  duelosPct:   parseFloat(fuzzy(row, ["duels won","duelos"]) || 0),
  recuperaciones: parseFloat(fuzzy(row, ["recoveries","recuperaciones"]) || 0),
  xg:          parseFloat(fuzzy(row, ["xg","expected goals"]) || 0),
  goles:       parseFloat(fuzzy(row, ["goals","goles"]) || 0),
  asistencias: parseFloat(fuzzy(row, ["assists","asistencias"]) || 0),
  presiones:   parseFloat(fuzzy(row, ["pressures","presiones"]) || 0),
});

// ═══════════════════════════════════════════════════════
//  ACWR CALCULATOR
// ═══════════════════════════════════════════════════════
const calcACWR = (loads) => {
  if (!loads || loads.length === 0) return 1.0;
  const acute  = loads.slice(-7).reduce((a, b) => a + b, 0) / 7;
  const chronic = loads.slice(-28).reduce((a, b) => a + b, 0) / 28;
  return chronic > 0 ? parseFloat((acute / chronic).toFixed(2)) : 1.0;
};

const acwrColor = (v) => v < 0.8 ? C.blue : v <= 1.3 ? C.green : v <= 1.5 ? C.yellow : C.red;
const acwrLabel = (v) => v < 0.8 ? "Carga baja" : v <= 1.3 ? "Zona óptima" : v <= 1.5 ? "Precaución" : "Riesgo lesión";

// ═══════════════════════════════════════════════════════
//  DEMO SEED DATA (used until real CSVs are uploaded)
// ═══════════════════════════════════════════════════════
const SEED_PLAYERS = [
  { id:1,  nombre:"Carlos Moreno",  pos:"DC",  edad:24, loads:[310,340,290,380,360,400,320], cat:null, wys:null },
  { id:2,  nombre:"Juan Herrera",   pos:"MCD", edad:27, loads:[420,390,440,410,460,480,390], cat:null, wys:null },
  { id:3,  nombre:"Andrés Ríos",    pos:"EXD", edad:22, loads:[280,300,260,320,290,310,270], cat:null, wys:null },
  { id:4,  nombre:"Felipe Castro",  pos:"DC",  edad:30, loads:[500,520,490,540,560,580,510], cat:null, wys:null },
  { id:5,  nombre:"Diego Vargas",   pos:"POR", edad:26, loads:[200,190,210,180,220,200,190], cat:null, wys:null },
  { id:6,  nombre:"Luis Patiño",    pos:"EXI", edad:23, loads:[350,370,340,390,360,410,350], cat:null, wys:null },
  { id:7,  nombre:"Miguel Torres",  pos:"MCO", edad:28, loads:[390,410,380,430,400,450,390], cat:null, wys:null },
  { id:8,  nombre:"Sebastián Gil",  pos:"LTD", edad:25, loads:[320,340,310,360,330,370,320], cat:null, wys:null },
  { id:9,  nombre:"Camilo Ruiz",    pos:"DEL", edad:21, loads:[480,510,470,540,520,570,490], cat:null, wys:null },
  { id:10, nombre:"Nicolás Ossa",   pos:"LTI", edad:29, loads:[300,310,290,330,300,340,300], cat:null, wys:null },
  { id:11, nombre:"Jhon Giraldo",   pos:"MCI", edad:24, loads:[360,380,350,400,370,420,360], cat:null, wys:null },
  { id:12, nombre:"Brayan López",   pos:"DEL", edad:26, loads:[430,450,420,470,440,490,430], cat:null, wys:null },
];

const SEED_WELLNESS = [
  { jugador:"Carlos Moreno",  sueno:8, fatiga:2, dolor:1, humor:9, estres:2, rpe:7 },
  { jugador:"Juan Herrera",   sueno:6, fatiga:7, dolor:5, humor:5, estres:6, rpe:8 },
  { jugador:"Andrés Ríos",    sueno:9, fatiga:1, dolor:1, humor:9, estres:1, rpe:6 },
  { jugador:"Felipe Castro",  sueno:5, fatiga:8, dolor:7, humor:4, estres:7, rpe:9 },
  { jugador:"Diego Vargas",   sueno:7, fatiga:3, dolor:2, humor:8, estres:3, rpe:7 },
  { jugador:"Luis Patiño",    sueno:6, fatiga:6, dolor:5, humor:6, estres:5, rpe:8 },
  { jugador:"Miguel Torres",  sueno:8, fatiga:2, dolor:2, humor:8, estres:2, rpe:6 },
  { jugador:"Sebastián Gil",  sueno:7, fatiga:4, dolor:3, humor:7, estres:4, rpe:7 },
  { jugador:"Camilo Ruiz",    sueno:6, fatiga:7, dolor:6, humor:5, estres:6, rpe:8 },
  { jugador:"Nicolás Ossa",   sueno:8, fatiga:3, dolor:2, humor:8, estres:3, rpe:7 },
  { jugador:"Jhon Giraldo",   sueno:7, fatiga:5, dolor:4, humor:6, estres:5, rpe:8 },
  { jugador:"Brayan López",   sueno:9, fatiga:2, dolor:1, humor:9, estres:2, rpe:6 },
];

// ═══════════════════════════════════════════════════════
//  SMALL UI ATOMS
// ═══════════════════════════════════════════════════════
const Tag = ({ label, color }) => (
  <span style={{ padding:"2px 8px", borderRadius:4, fontSize:10, fontWeight:700,
    letterSpacing:"0.06em", background:`${color}18`, color, border:`1px solid ${color}28` }}>
    {label}
  </span>
);

const WDot = ({ val, invert }) => {
  const v = invert ? 10 - val : val;
  const c = v >= 7 ? C.green : v >= 5 ? C.yellow : C.red;
  return (
    <div style={{ width:26, height:26, borderRadius:"50%", display:"flex", alignItems:"center",
      justifyContent:"center", fontSize:11, fontWeight:800, color:c,
      background:`${c}15`, border:`1px solid ${c}28`, flexShrink:0 }}>{val}</div>
  );
};

const Sparkline = ({ data, color, w=80, h=26 }) => {
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h-((v-min)/range)*h}`).join(" ");
  const last = data[data.length-1];
  const lx = w, ly = h - ((last - min)/range)*h;
  return (
    <svg width={w} height={h}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={lx} cy={ly} r="3" fill={color}/>
    </svg>
  );
};

const ACWRGauge = ({ value }) => {
  const cx=65, cy=56, r=44;
  const zones = [[0,60,C.blue],[60,100,C.green],[100,130,C.yellow],[130,180,C.red]];
  const arc = ([s,e,col]) => {
    const sa=(s/180)*Math.PI-Math.PI, ea=(e/180)*Math.PI-Math.PI;
    const x1=cx+r*Math.cos(sa),y1=cy+r*Math.sin(sa),x2=cx+r*Math.cos(ea),y2=cy+r*Math.sin(ea);
    return <path key={s} d={`M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`}
      fill="none" stroke={col} strokeWidth="8" strokeLinecap="round"/>;
  };
  const pct = Math.min(Math.max((value-0.5)/1.5,0),1);
  const na = pct*180-90, nr=(r-8);
  const nx=cx+nr*Math.cos((na/180)*Math.PI), ny=cy+nr*Math.sin((na/180)*Math.PI);
  const col = acwrColor(value);
  return (
    <svg width={130} height={72}>
      {zones.map(arc)}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={col} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="3.5" fill={col}/>
      <text x={cx} y={cy+16} textAnchor="middle" fontSize="15" fontWeight="800" fill={col} fontFamily="monospace">{value}</text>
      <text x={cx} y={cy+26} textAnchor="middle" fontSize="7" fill={C.muted}>ACWR</text>
    </svg>
  );
};

// ═══════════════════════════════════════════════════════
//  DROP ZONE
// ═══════════════════════════════════════════════════════
const DropZone = ({ label, icon, color, accept, onFile, loading, compact }) => {
  const [drag, setDrag] = useState(false);
  const ref = useRef();
  return (
    <div onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onFile(f);}}
      onClick={()=>ref.current.click()}
      style={{ border:`2px dashed ${drag?color:C.border}`, borderRadius:12,
        padding: compact?"14px 16px":"24px 18px", textAlign:"center", cursor:"pointer",
        transition:"all 0.2s", background:drag?`${color}08`:"transparent" }}>
      <input ref={ref} type="file" accept={accept} style={{display:"none"}}
        onChange={e=>{const f=e.target.files[0];if(f)onFile(f);}}/>
      {loading
        ? <div style={{color,fontSize:12}}>⏳ Procesando...</div>
        : compact
          ? <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
              <span style={{color,fontSize:16}}>{icon}</span>
              <span style={{fontSize:11,color:C.muted}}>Arrastra CSV · {label}</span>
              <span style={{padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,
                background:`${color}15`,color,border:`1px solid ${color}25`}}>Subir</span>
            </div>
          : <>
              <div style={{fontSize:24,marginBottom:6,color}}>{icon}</div>
              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:3}}>{label}</div>
              <div style={{fontSize:10,color:C.muted,marginBottom:10}}>Arrastra tu archivo CSV aquí</div>
              <span style={{padding:"5px 14px",borderRadius:8,fontSize:11,fontWeight:700,
                background:`${color}15`,color,border:`1px solid ${color}28`}}>Seleccionar archivo</span>
            </>
      }
    </div>
  );
};

// ═══════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════
export default function PerfLoad() {
  const [page, setPage]           = useState("dashboard");
  const [players, setPlayers]     = useState(SEED_PLAYERS);
  const [wellness]   = useState(SEED_WELLNESS);
  const [catRaw, setCatRaw]       = useState(null);   // raw catapult rows
  const [wysRaw, setWysRaw]       = useState(null);   // raw wyscout rows
  const [loading, setLoading]     = useState({});
  const [flash, setFlash]         = useState(null);   // { msg, color }
  const [selPlayer, setSelPlayer] = useState(null);
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [gConnected, setGConnected] = useState(false);
  const [loaded, setLoaded]       = useState(false);

  useEffect(()=>{ setTimeout(()=>setLoaded(true),120); },[]);

  // ── Flash notification ──
  const showFlash = (msg, color=C.green) => {
    setFlash({msg,color});
    setTimeout(()=>setFlash(null), 3200);
  };

  // ── Process Catapult CSV → update players ──
  const processCatapult = useCallback((file) => {
    setLoading(l=>({...l,cat:true}));
    const reader = new FileReader();
    reader.onload = e => {
      setTimeout(()=>{
        const rows = parseCSV(e.target.result).map(mapCatapult);
        setCatRaw(rows);
        // Merge into players by name (fuzzy)
        setPlayers(prev => prev.map(p => {
          const match = rows.find(r =>
            r.jugador.toLowerCase().includes(p.nombre.toLowerCase().split(" ")[0].toLowerCase())
          );
          if (!match) return p;
          const newLoads = [...p.loads, match.playerLoad || match.distancia/100].slice(-28);
          return { ...p, loads: newLoads, cat: match };
        }));
        setLoading(l=>({...l,cat:false}));
        showFlash(`✓ Catapult cargado · ${rows.length} registros procesados`);
      }, 900);
    };
    reader.readAsText(file);
  }, []);

  // ── Process Wyscout CSV → update players ──
  const processWyscout = useCallback((file) => {
    setLoading(l=>({...l,wys:true}));
    const reader = new FileReader();
    reader.onload = e => {
      setTimeout(()=>{
        const rows = parseCSV(e.target.result).map(mapWyscout);
        setWysRaw(rows);
        setPlayers(prev => prev.map(p => {
          const match = rows.find(r =>
            r.jugador.toLowerCase().includes(p.nombre.toLowerCase().split(" ")[0].toLowerCase())
          );
          return match ? { ...p, wys: match } : p;
        }));
        setLoading(l=>({...l,wys:false}));
        showFlash(`✓ Wyscout cargado · ${rows.length} registros procesados`, C.blue);
      }, 900);
    };
    reader.readAsText(file);
  }, []);

  // ── Connect Google Sheets (simulated) ──
  const connectGoogle = () => {
    if (!sheetsUrl.includes("docs.google.com/spreadsheets")) {
      showFlash("⚠ Enlace inválido — debe ser un Google Sheet", C.yellow);
      return;
    }
    setLoading(l=>({...l,google:true}));
    setTimeout(()=>{
      setGConnected(true);
      setLoading(l=>({...l,google:false}));
      showFlash("✓ Google Forms conectado · Datos de wellness actualizados", C.purple);
    }, 1200);
  };

  // ── Computed values ──
  const playersWithACWR = players.map(p => ({
    ...p,
    acwr: calcACWR(p.loads),
    status: (() => {
      const a = calcACWR(p.loads);
      const w = wellness.find(w => w.jugador === p.nombre);
      if (a > 1.5 || (w && (w.fatiga >= 7 || w.dolor >= 6))) return "risk";
      if (a > 1.3 || (w && (w.fatiga >= 5 || w.dolor >= 4))) return "caution";
      return "optimal";
    })(),
    wellness: wellness.find(w => w.jugador === p.nombre) || null,
  }));

  const statusCount = playersWithACWR.reduce((a,p)=>{ a[p.status]=(a[p.status]||0)+1; return a; },{});
  const avgACWR = parseFloat((playersWithACWR.reduce((a,p)=>a+p.acwr,0)/playersWithACWR.length).toFixed(2));
  

  const statusCfg = {
    optimal: { label:"Óptimo",     color:C.green  },
    caution: { label:"Precaución", color:C.yellow },
    risk:    { label:"Riesgo",     color:C.red    },
  };

  // ═══════════════════════════════════════════════════
  //  STYLES
  // ═══════════════════════════════════════════════════
  const S = {
    app:  { display:"flex", minHeight:"100vh", background:C.bg, color:C.text,
            fontFamily:"'Outfit','DM Sans',sans-serif" },
    sidebar: { width:210, background:C.surface, borderRight:`1px solid ${C.border}`,
               display:"flex", flexDirection:"column", flexShrink:0,
               position:"sticky", top:0, height:"100vh", overflowY:"auto" },
    main: { flex:1, padding:"28px 32px", overflowY:"auto",
            opacity:loaded?1:0, transform:loaded?"translateY(0)":"translateY(12px)",
            transition:"all 0.45s cubic-bezier(.4,0,.2,1)" },
    logo: { padding:"22px 20px 16px", borderBottom:`1px solid ${C.border}` },
    nav:  { flex:1, padding:"12px 10px", display:"flex", flexDirection:"column", gap:2 },
    navItem: (a) => ({ display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
      borderRadius:10, cursor:"pointer", transition:"all 0.15s",
      background:a?"rgba(0,230,118,0.1)":"transparent",
      color:a?C.green:C.muted, fontSize:12, fontWeight:a?700:400,
      borderLeft:a?`2px solid ${C.green}`:"2px solid transparent" }),
    card: (x={}) => ({ background:C.card, border:`1px solid ${C.border}`,
      borderRadius:14, padding:"18px 20px", ...x }),
    g4:   { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:18 },
    g3:   { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:18 },
    g2:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 },
    sec:  { fontSize:10, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase",
            color:C.muted, marginBottom:12 },
    th:   { padding:"7px 10px", textAlign:"left", color:C.muted, fontSize:9,
            fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase",
            borderBottom:`1px solid ${C.border}`, whiteSpace:"nowrap" },
    td:   { padding:"9px 10px", borderBottom:`1px solid ${C.border}`, fontSize:12 },
    bar:  (pct,col) => ({ height:3, borderRadius:2,
      background:`linear-gradient(90deg,${col} ${pct}%,${C.dim} ${pct}%)` }),
  };

  const navItems = [
    { id:"dashboard", icon:"⬡", label:"Dashboard"       },
    { id:"plantilla", icon:"◈", label:"Plantilla"       },
    { id:"carga",     icon:"◉", label:"Control Carga"   },
    { id:"importar",  icon:"↑", label:"Importar Datos"  },
    { id:"wellness",  icon:"♡", label:"Wellness / RPE"  },
  ];

  // ═══════════════════════════════════════════════════
  //  PAGES
  // ═══════════════════════════════════════════════════

  // ── DASHBOARD ──
  const PageDashboard = () => (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
        <div>
          <div style={{fontSize:24,fontWeight:800,letterSpacing:"-0.025em",color:"#f0f5ff"}}>Centro de Control</div>
          <div style={{fontSize:12,color:C.muted,marginTop:3}}>
            Semana 28 · Liga BetPlay ·
            <span style={{color: catRaw?C.green:C.muted, marginLeft:6}}>
              {catRaw ? `✓ GPS cargado (${catRaw.length} reg.)` : "Sin datos GPS"}
            </span>
            <span style={{color: wysRaw?C.blue:C.muted, marginLeft:10}}>
              {wysRaw ? `✓ Wyscout cargado` : "Sin datos tácticos"}
            </span>
            <span style={{color: gConnected?C.purple:C.muted, marginLeft:10}}>
              {gConnected ? "✓ Wellness activo" : "Sin wellness"}
            </span>
          </div>
        </div>
        <button onClick={()=>setPage("importar")} style={{
          padding:"8px 16px", borderRadius:10, background:`${C.green}18`,
          color:C.green, border:`1px solid ${C.green}30`, fontSize:11,
          fontWeight:700, cursor:"pointer" }}>
          ↑ Importar datos
        </button>
      </div>

      {/* KPIs */}
      <div style={S.g4}>
        {[
          { label:"Jugadores",    val:players.length,          color:C.text,   sub:"en plantilla" },
          { label:"Estado óptimo",val:statusCount.optimal||0,  color:C.green,  sub:`${Math.round(((statusCount.optimal||0)/players.length)*100)}% plantilla` },
          { label:"Precaución",   val:statusCount.caution||0,  color:C.yellow, sub:"monitoreo activo" },
          { label:"Riesgo",       val:statusCount.risk||0,     color:C.red,    sub:"atención inmediata" },
        ].map((k,i)=>(
          <div key={i} style={S.card()}>
            <div style={{fontSize:30,fontWeight:900,color:k.color,fontFamily:"monospace",lineHeight:1}}>{k.val}</div>
            <div style={{fontSize:11,fontWeight:700,color:C.text,marginTop:6}}>{k.label}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>{k.sub}</div>
          </div>
        ))}
      </div>

      <div style={S.g2}>
        {/* Plantilla */}
        <div style={S.card()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={S.sec}>Estado plantilla</div>
            <span style={{fontSize:10,color:C.muted}}>{players.length} jugadores</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:320,overflowY:"auto"}}>
            {playersWithACWR.map(p => {
              const sc = statusCfg[p.status];
              return (
                <div key={p.id} onClick={()=>{ setSelPlayer(p); setPage("carga"); }}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                    borderRadius:8, cursor:"pointer", transition:"all 0.15s",
                    background:selPlayer?.id===p.id?`${sc.color}10`:"rgba(255,255,255,0.02)",
                    border:`1px solid ${selPlayer?.id===p.id?sc.color+"30":C.border}` }}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:sc.color,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:C.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.nombre}</div>
                    <div style={{fontSize:10,color:C.muted}}>{p.pos} · {p.edad}a</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:11,fontFamily:"monospace",fontWeight:700,color:acwrColor(p.acwr)}}>{p.acwr}</div>
                    <div style={{fontSize:9,color:C.muted}}>ACWR</div>
                  </div>
                  <Sparkline data={p.loads.slice(-7)} color={sc.color} w={50} h={20}/>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right col */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* ACWR */}
          <div style={S.card()}>
            <div style={S.sec}>ACWR Equipo</div>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <ACWRGauge value={avgACWR}/>
              <div>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>Distribución:</div>
                {["optimal","caution","risk"].map(s=>(
                  <div key={s} style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:statusCfg[s].color}}/>
                    <span style={{fontSize:11,color:C.muted,flex:1}}>{statusCfg[s].label}</span>
                    <span style={{fontSize:12,fontWeight:700,color:statusCfg[s].color,fontFamily:"monospace"}}>{statusCount[s]||0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div style={S.card({flex:1})}>
            <div style={S.sec}>Alertas activas</div>
            {playersWithACWR.filter(p=>p.status!=="optimal").length === 0
              ? <div style={{fontSize:12,color:C.muted,textAlign:"center",padding:"20px 0"}}>
                  ✓ Sin alertas — plantilla en estado óptimo
                </div>
              : playersWithACWR.filter(p=>p.status!=="optimal").map(p=>{
                  const sc=statusCfg[p.status];
                  return (
                    <div key={p.id} onClick={()=>{setSelPlayer(p);setPage("carga");}}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                        borderRadius:8,marginBottom:6,cursor:"pointer",
                        background:`${sc.color}08`,border:`1px solid ${sc.color}22`}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:sc.color,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,fontWeight:700}}>{p.nombre}</div>
                        <div style={{fontSize:10,color:C.muted}}>
                          ACWR {p.acwr} · {acwrLabel(p.acwr)}
                          {p.wellness?.fatiga>=5?` · Fatiga ${p.wellness.fatiga}/10`:""}
                        </div>
                      </div>
                      <Tag label={sc.label} color={sc.color}/>
                    </div>
                  );
                })
            }
          </div>

          {/* Import shortcuts */}
          <div style={S.card()}>
            <div style={S.sec}>Importación rápida</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <DropZone compact label="GPS Catapult" icon="▸" color={C.green}
                accept=".csv" loading={loading.cat} onFile={processCatapult}/>
              <DropZone compact label="Wyscout" icon="◎" color={C.blue}
                accept=".csv,.xlsx" loading={loading.wys} onFile={processWyscout}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ── CONTROL CARGA ──
  const PageCarga = () => {
    const p = selPlayer || playersWithACWR[0];
    if (!p) return null;
    const w = p.wellness;
    return (
      <div>
        {/* Player selector */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",color:C.muted,marginBottom:8}}>Seleccionar jugador</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {playersWithACWR.map(pl=>(
              <button key={pl.id} onClick={()=>setSelPlayer(pl)} style={{
                padding:"5px 12px",borderRadius:8,fontSize:11,fontWeight:600,cursor:"pointer",
                background:selPlayer?.id===pl.id?`${statusCfg[pl.status].color}20`:"transparent",
                color:selPlayer?.id===pl.id?statusCfg[pl.status].color:C.muted,
                border:`1px solid ${selPlayer?.id===pl.id?statusCfg[pl.status].color+"40":C.border}`}}>
                {pl.nombre.split(" ")[0]} {pl.nombre.split(" ")[1]?.[0]}.
              </button>
            ))}
          </div>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:20}}>
          <div style={{width:44,height:44,borderRadius:12,background:`${statusCfg[p.status].color}18`,
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,
            color:statusCfg[p.status].color,border:`1px solid ${statusCfg[p.status].color}28`}}>
            {p.pos[0]}
          </div>
          <div>
            <div style={{fontSize:20,fontWeight:800,letterSpacing:"-0.02em"}}>{p.nombre}</div>
            <div style={{fontSize:12,color:C.muted}}>{p.pos} · {p.edad} años · <Tag label={statusCfg[p.status].label} color={statusCfg[p.status].color}/></div>
          </div>
          <div style={{marginLeft:"auto",textAlign:"right"}}>
            <div style={{fontSize:28,fontWeight:900,color:acwrColor(p.acwr),fontFamily:"monospace"}}>{p.acwr}</div>
            <div style={{fontSize:10,color:C.muted}}>ACWR · {acwrLabel(p.acwr)}</div>
          </div>
        </div>

        <div style={S.g2}>
          {/* GPS Catapult */}
          <div style={S.card()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={S.sec}>GPS Catapult</div>
              {!p.cat && <Tag label="Sin datos — sube CSV" color={C.muted}/>}
              {p.cat  && <Tag label="✓ Datos reales" color={C.green}/>}
            </div>
            {[
              { label:"Distancia total",    val: p.cat ? `${(p.cat.distancia||0).toLocaleString()} m` : `${((p.loads[p.loads.length-1]||350)*28).toLocaleString()} m`, pct:82, color:C.green },
              { label:"HSR (>18 km/h)",     val: p.cat ? `${p.cat.hsr||0} m`         : "1.240 m", pct:68, color:C.blue  },
              { label:"Sprint (>24 km/h)",  val: p.cat ? `${p.cat.sprint||0} m`      : "380 m",   pct:55, color:C.purple},
              { label:"Aceleraciones",      val: p.cat ? `${p.cat.acels||0}`          : "48",      pct:74, color:C.yellow},
              { label:"Deceleraciones",     val: p.cat ? `${p.cat.decels||0}`         : "52",      pct:78, color:C.orange},
              { label:"Player Load",        val: p.cat ? `${p.cat.playerLoad||0} UA` : `${p.loads[p.loads.length-1]||380} UA`, pct:76, color:C.red },
            ].map((m,i)=>(
              <div key={i} style={{marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:11,color:C.muted}}>{m.label}</span>
                  <span style={{fontSize:12,fontWeight:700,color:C.text,fontFamily:"monospace"}}>{m.val}</span>
                </div>
                <div style={S.bar(m.pct,m.color)}/>
              </div>
            ))}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Wyscout */}
            <div style={S.card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={S.sec}>Wyscout</div>
                {!p.wys && <Tag label="Sin datos — sube CSV" color={C.muted}/>}
                {p.wys  && <Tag label="✓ Datos reales" color={C.blue}/>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[
                  { label:"Pases %",       val: p.wys ? `${p.wys.pasesPct||0}%` : "87%",  color:C.green  },
                  { label:"Duelos %",      val: p.wys ? `${p.wys.duelosPct||0}%`: "62%",  color:C.blue   },
                  { label:"Recuperaciones",val: p.wys ? `${p.wys.recuperaciones||0}` : "8", color:C.purple},
                  { label:"xG",            val: p.wys ? `${p.wys.xg||0}`         : "0.4", color:C.yellow },
                  { label:"Goles",         val: p.wys ? `${p.wys.goles||0}`      : "0",   color:C.orange },
                  { label:"Presiones",     val: p.wys ? `${p.wys.presiones||0}`  : "14",  color:C.red    },
                ].map((m,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.025)",borderRadius:8,
                    padding:"10px 12px",border:`1px solid ${C.border}`}}>
                    <div style={{fontSize:18,fontWeight:800,color:m.color,fontFamily:"monospace"}}>{m.val}</div>
                    <div style={{fontSize:9,color:C.muted,marginTop:2}}>{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Wellness */}
            <div style={S.card()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={S.sec}>Wellness hoy</div>
                {!gConnected && <Tag label="Conecta Google Forms" color={C.muted}/>}
              </div>
              {w ? (
                <>
                  <div style={{display:"flex",gap:8,marginBottom:12}}>
                    {[
                      {label:"Sueño",   val:w.sueno,  inv:false},
                      {label:"Fatiga",  val:w.fatiga, inv:true},
                      {label:"Dolor",   val:w.dolor,  inv:true},
                      {label:"Humor",   val:w.humor,  inv:false},
                      {label:"Estrés",  val:w.estres, inv:true},
                    ].map((d,i)=>(
                      <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,flex:1}}>
                        <WDot val={d.val} invert={d.inv}/>
                        <span style={{fontSize:8,color:C.muted}}>{d.label}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)"}}>
                    <span style={{fontSize:11,color:C.muted}}>RPE sesión anterior</span>
                    <span style={{fontSize:22,fontWeight:900,color:C.orange,fontFamily:"monospace"}}>{w.rpe}/10</span>
                  </div>
                </>
              ) : (
                <div style={{textAlign:"center",padding:"16px 0",fontSize:12,color:C.muted}}>Sin datos de wellness</div>
              )}
            </div>

            {/* Tendencia */}
            <div style={S.card()}>
              <div style={S.sec}>Player Load — últimos 7 días</div>
              <div style={{display:"flex",alignItems:"center",gap:14}}>
                <Sparkline data={p.loads.slice(-7)} color={acwrColor(p.acwr)} w={120} h={40}/>
                <div>
                  <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Carga aguda (7d)</div>
                  <div style={{fontSize:16,fontWeight:800,color:C.text,fontFamily:"monospace"}}>
                    {Math.round(p.loads.slice(-7).reduce((a,b)=>a+b,0)/7)} UA/día
                  </div>
                  <div style={{fontSize:10,color:acwrColor(p.acwr),marginTop:2}}>ACWR {p.acwr}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── IMPORTAR ──
  const PageImportar = () => (
    <div>
      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em",marginBottom:6}}>Importar Datos</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:22}}>
        Arrastra los archivos — el dashboard se actualiza automáticamente
      </div>

      <div style={S.g3}>
        {/* Catapult */}
        <div style={S.card()}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <div style={{width:28,height:28,borderRadius:8,background:`${C.green}18`,
              display:"flex",alignItems:"center",justifyContent:"center",color:C.green,fontSize:14}}>▸</div>
            <div>
              <div style={{fontSize:13,fontWeight:700}}>GPS Catapult</div>
              <div style={{fontSize:10,color:C.muted}}>OpenField CSV</div>
            </div>
            {catRaw && <Tag label={`✓ ${catRaw.length} reg.`} color={C.green}/>}
          </div>
          <DropZone label="Arrastra CSV de OpenField" icon="▸" color={C.green}
            accept=".csv" loading={loading.cat} onFile={processCatapult}/>
          <div style={{marginTop:10,fontSize:10,color:C.muted,lineHeight:1.7}}>
            En OpenField: Reports → Session Summary → Export CSV
          </div>
          {catRaw && (
            <div style={{marginTop:12,overflowX:"auto"}}>
              <div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:6}}>Vista previa:</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead><tr>
                  {["Jugador","Dist.","HSR","Sprint","P.Load"].map(h=>(
                    <th key={h} style={{...S.th,fontSize:9}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {catRaw.slice(0,4).map((r,i)=>(
                    <tr key={i}>
                      <td style={{...S.td,fontSize:10,fontWeight:600}}>{r.jugador}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace",color:C.green}}>{r.distancia?.toLocaleString()||"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace"}}>{r.hsr||"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace"}}>{r.sprint||"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace",color:C.orange}}>{r.playerLoad||"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Wyscout */}
        <div style={S.card()}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <div style={{width:28,height:28,borderRadius:8,background:`${C.blue}18`,
              display:"flex",alignItems:"center",justifyContent:"center",color:C.blue,fontSize:14}}>◎</div>
            <div>
              <div style={{fontSize:13,fontWeight:700}}>Wyscout</div>
              <div style={{fontSize:10,color:C.muted}}>Statistics CSV/Excel</div>
            </div>
            {wysRaw && <Tag label={`✓ ${wysRaw.length} reg.`} color={C.blue}/>}
          </div>
          <DropZone label="Arrastra CSV de Wyscout" icon="◎" color={C.blue}
            accept=".csv,.xlsx,.xls" loading={loading.wys} onFile={processWyscout}/>
          <div style={{marginTop:10,fontSize:10,color:C.muted,lineHeight:1.7}}>
            En Wyscout: Statistics → Players → Filtrar → Descargar CSV
          </div>
          {wysRaw && (
            <div style={{marginTop:12,overflowX:"auto"}}>
              <div style={{fontSize:10,color:C.blue,fontWeight:700,marginBottom:6}}>Vista previa:</div>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                <thead><tr>
                  {["Jugador","Min","Pases%","xG","Recup."].map(h=>(
                    <th key={h} style={{...S.th,fontSize:9}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {wysRaw.slice(0,4).map((r,i)=>(
                    <tr key={i}>
                      <td style={{...S.td,fontSize:10,fontWeight:600}}>{r.jugador}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace"}}>{r.minutos||"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace",color:C.green}}>{r.pasesPct?`${r.pasesPct}%`:"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace",color:C.yellow}}>{r.xg||"—"}</td>
                      <td style={{...S.td,fontSize:10,fontFamily:"monospace"}}>{r.recuperaciones||"—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Google Forms */}
        <div style={S.card()}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
            <div style={{width:28,height:28,borderRadius:8,background:`${C.purple}18`,
              display:"flex",alignItems:"center",justifyContent:"center",color:C.purple,fontSize:14}}>♡</div>
            <div>
              <div style={{fontSize:13,fontWeight:700}}>Google Forms</div>
              <div style={{fontSize:10,color:C.muted}}>Wellness / RPE diario</div>
            </div>
            {gConnected && <Tag label="✓ Conectado" color={C.green}/>}
          </div>

          {!gConnected ? (
            <>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.7,marginBottom:12}}>
                Pega el enlace del Google Sheet donde se guardan las respuestas de tu Form:
              </div>
              <input value={sheetsUrl} onChange={e=>setSheetsUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                style={{width:"100%",padding:"9px 12px",borderRadius:9,fontSize:11,
                  background:C.surface,border:`1px solid ${C.border}`,color:C.text,
                  outline:"none",fontFamily:"inherit",boxSizing:"border-box",marginBottom:8}}/>
              <button onClick={connectGoogle} disabled={loading.google}
                style={{width:"100%",padding:"9px",borderRadius:9,background:loading.google?`${C.purple}50`:C.purple,
                  color:"#06080f",fontSize:11,fontWeight:800,border:"none",cursor:"pointer"}}>
                {loading.google?"⏳ Conectando...":"⚡ Conectar Google Forms"}
              </button>
              <div style={{marginTop:10,fontSize:10,color:C.muted,lineHeight:1.7}}>
                Form → Respuestas → ícono Sheets → Compartir enlace como Lector
              </div>
            </>
          ) : (
            <div>
              <div style={{padding:"10px 12px",borderRadius:8,background:`${C.green}10`,
                border:`1px solid ${C.green}25`,marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:C.green}}>✓ Sincronizado</div>
                <div style={{fontSize:10,color:C.muted}}>Última actualización: hace 2 min</div>
              </div>
              {wellness.slice(0,4).map((w,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{fontSize:11,fontWeight:600,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{w.jugador}</div>
                  <WDot val={w.sueno}/>
                  <WDot val={w.fatiga} invert/>
                  <WDot val={w.humor}/>
                  <span style={{fontSize:10,fontFamily:"monospace",color:C.orange,fontWeight:700}}>{w.rpe}/10</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      <div style={S.card()}>
        <div style={S.sec}>Estado de integración</div>
        <div style={{display:"flex",gap:20}}>
          {[
            {label:"GPS Catapult", ok:!!catRaw, n:catRaw?.length, color:C.green},
            {label:"Wyscout",      ok:!!wysRaw, n:wysRaw?.length, color:C.blue},
            {label:"Google Forms", ok:gConnected, n:wellness.length, color:C.purple},
          ].map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:s.ok?s.color:C.dim}}/>
              <span style={{fontSize:12,color:s.ok?C.text:C.muted}}>{s.label}</span>
              {s.ok && <Tag label={`${s.n} registros`} color={s.color}/>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── WELLNESS ──
  const PageWellness = () => (
    <div>
      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em",marginBottom:6}}>Wellness / RPE</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:22}}>Monitoreo diario de bienestar</div>
      <div style={{...S.card(),overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>{["Jugador","Pos","Sueño","Fatiga","Dolor","Humor","Estrés","RPE","Estado"].map(h=>(
              <th key={h} style={S.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {playersWithACWR.map(p => {
              const w = p.wellness;
              const sc = statusCfg[p.status];
              return (
                <tr key={p.id} onClick={()=>{setSelPlayer(p);setPage("carga");}}
                  style={{cursor:"pointer", transition:"background 0.12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{...S.td,fontWeight:700}}>{p.nombre}</td>
                  <td style={{...S.td,color:C.muted}}>{p.pos}</td>
                  {w ? <>
                    <td style={S.td}><WDot val={w.sueno}/></td>
                    <td style={S.td}><WDot val={w.fatiga} invert/></td>
                    <td style={S.td}><WDot val={w.dolor} invert/></td>
                    <td style={S.td}><WDot val={w.humor}/></td>
                    <td style={S.td}><WDot val={w.estres} invert/></td>
                    <td style={{...S.td,fontFamily:"monospace",fontWeight:700,color:C.orange}}>{w.rpe}/10</td>
                  </> : <>{Array(6).fill(0).map((_,i)=><td key={i} style={{...S.td,color:C.dim}}>—</td>)}</>}
                  <td style={S.td}><Tag label={sc.label} color={sc.color}/></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ── PLANTILLA ──
  const PagePlantilla = () => (
    <div>
      <div style={{fontSize:22,fontWeight:800,letterSpacing:"-0.02em",marginBottom:6}}>Plantilla</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:22}}>{players.length} jugadores registrados</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
        {playersWithACWR.map(p=>{
          const sc=statusCfg[p.status];
          return (
            <div key={p.id} onClick={()=>{setSelPlayer(p);setPage("carga");}}
              style={{...S.card({cursor:"pointer",transition:"all 0.15s",borderColor:`${sc.color}25`})}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700}}>{p.nombre}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:2}}>{p.pos} · {p.edad} años</div>
                </div>
                <Tag label={sc.label} color={sc.color}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:20,fontWeight:900,color:acwrColor(p.acwr),fontFamily:"monospace"}}>{p.acwr}</div>
                  <div style={{fontSize:9,color:C.muted}}>ACWR</div>
                </div>
                <Sparkline data={p.loads.slice(-7)} color={sc.color} w={70} h={28}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={S.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input::placeholder{color:rgba(255,255,255,0.18);}
        input:focus{border-color:rgba(255,255,255,0.18)!important;outline:none;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.09);border-radius:2px;}
        button:active{transform:scale(0.97);}
      `}</style>

      {/* Flash notification */}
      {flash && (
        <div style={{ position:"fixed", top:18, right:18, zIndex:999,
          padding:"10px 18px", borderRadius:10, fontSize:12, fontWeight:700,
          background:`${flash.color}18`, color:flash.color,
          border:`1px solid ${flash.color}35`, backdropFilter:"blur(12px)",
          boxShadow:"0 4px 24px rgba(0,0,0,0.5)",
          animation:"fadeIn 0.25s ease" }}>
          {flash.msg}
        </div>
      )}

      {/* Sidebar */}
      <aside style={S.sidebar}>
        <div style={S.logo}>
          <div style={{fontSize:13,fontWeight:800,letterSpacing:"0.1em",color:C.green,fontFamily:"monospace"}}>⬡ PERFLOAD</div>
          <div style={{fontSize:9,color:C.muted,letterSpacing:"0.08em",marginTop:3,textTransform:"uppercase"}}>Colombia · Fútbol Pro</div>
        </div>
        <nav style={S.nav}>
          {navItems.map(item=>(
            <div key={item.id} style={S.navItem(page===item.id)} onClick={()=>setPage(item.id)}>
              <span style={{fontFamily:"monospace",fontSize:13,width:16,textAlign:"center"}}>{item.icon}</span>
              <span>{item.label}</span>
              {item.id==="importar" && (catRaw||wysRaw||gConnected) &&
                <span style={{marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:C.green}}/>}
            </div>
          ))}
        </nav>
        <div style={{padding:"14px 18px",borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em"}}>Fuentes activas</div>
          <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:4}}>
            {[{label:"GPS",color:catRaw?C.green:C.dim},{label:"Wyscout",color:wysRaw?C.blue:C.dim},{label:"Wellness",color:gConnected?C.purple:C.dim}].map((s,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:5,height:5,borderRadius:"50%",background:s.color}}/>
                <span style={{fontSize:9,color:s.color}}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={S.main}>
        <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}`}</style>
        {page==="dashboard" && <PageDashboard/>}
        {page==="plantilla" && <PagePlantilla/>}
        {page==="carga"     && <PageCarga/>}
        {page==="importar"  && <PageImportar/>}
        {page==="wellness"  && <PageWellness/>}
      </main>
    </div>
  );
}