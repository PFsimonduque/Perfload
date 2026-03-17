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
//  CSV PARSER  — Catapult OpenField format
//  Los archivos OpenField tienen ~9 filas de metadatos
//  antes de la fila de encabezados ("Player Name",...)
// ═══════════════════════════════════════════════════════
const parseCSVLine = (line) => {
  // Parser que respeta comillas (campos con comas dentro)
  const result = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
};

const parseCSV = (text) => {
  // Eliminar BOM si existe
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  // Buscar la fila que contiene "Player Name" como primera columna
  let headerIdx = lines.findIndex(l => l.includes('"Player Name"') || l.startsWith("Player Name"));
  if (headerIdx === -1) {
    // Fallback: usar primera línea
    headerIdx = 0;
  }
  const headers = parseCSVLine(lines[headerIdx]).map(h => h.replace(/"/g,"").trim());
  const data = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const vals = parseCSVLine(l).map(v => v.replace(/"/g,"").trim());
    if (vals.length < 5) continue;
    data.push(Object.fromEntries(headers.map((h, idx) => [h, vals[idx] ?? ""])));
  }
  return data;
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

// Mapeo exacto para Catapult OpenField Cloud (columnas verificadas con datos reales)
const mapCatapult = (row) => {
  // Solo procesar filas de sesión completa (Period Number = 0)
  const periodNum = row["Period Number"] ?? row["Period_Number"] ?? "";
  if (periodNum !== "" && periodNum !== "0") return null;

  const pf = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  return {
    jugador:    (row["Player Name"] || fuzzy(row, ["player name","athlete"]) || "—").trim(),
    fecha:      row["Date"] || fuzzy(row, ["date","fecha"]) || "—",
    actividad:  row["Activity Name"] || fuzzy(row, ["activity name"]) || "—",
    posicion:   row["Position Name"] || fuzzy(row, ["position"]) || "—",
    duracion:   row["Total Duration"] || "—",
    // Métricas principales
    distancia:  pf(row["Total Distance"]),
    playerLoad: pf(row["Total Player Load"]),
    plpm:       pf(row["Player Load Per Minute"]),
    mpm:        pf(row["Meterage Per Minute"]),
    velMax:     pf(row["Maximum Velocity"]),
    velProm:    pf(row["Average Velocity"]),
    hrProm:     pf(row["Avg Heart Rate"]),
    hrMax:      pf(row["Maximum Heart Rate"]),
    // Zonas de velocidad (m)
    vb1:        pf(row["Velocity Band 1 Total Distance"]),
    vb2:        pf(row["Velocity Band 2 Total Distance"]),
    vb3:        pf(row["Velocity Band 3 Total Distance"]),
    vb4:        pf(row["Velocity Band 4 Total Distance"]),
    hsr:        pf(row["Velocity Band 5 Total Distance"]),  // >19.8 km/h
    sprint:     pf(row["Velocity Band 6 Total Distance"]),  // >25.2 km/h
    vb7:        pf(row["Velocity Band 7 Total Distance"]),
    vb8:        pf(row["Velocity Band 8 Total Distance"]),
    // Esfuerzos explosivos
    sprintsN:   pf(row["N Sprints +25km/h"] || row["Velocity B6+ Total # Efforts (Gen2)"] || 0),
    distSprint: pf(row["Distancia en Sprint (m)"] || 0),
    acelsH:     pf(row["IMA Accel High"]),
    acelsM:     pf(row["IMA Accel Medium"]),
    decelsH:    pf(row["IMA Decel High"]),
    decelsM:    pf(row["IMA Decel Medium"]),
    acels:      pf(row["IMA Accel High"]) + pf(row["IMA Accel Medium"]),
    decels:     pf(row["IMA Decel High"]) + pf(row["IMA Decel Medium"]),
    // Potencia metabólica
    peakPower:  pf(row["Peak Meta Power"]),
    hmld:       pf(row["HMLD (Gen 2)"] || row["High Metabolic Load Distance"] || 0),
  };
};

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

const acwrColor = (v) => (v < 0.8 || v > 1.5) ? C.red : (v < 0.94 || v > 1.35) ? C.yellow : C.green;
const acwrLabel = (v) => v < 0.8 ? "Carga muy baja" : v < 0.94 ? "Precaución — baja" : v <= 1.35 ? "Zona óptima" : v <= 1.5 ? "Precaución — alta" : "Riesgo lesión";

// ═══════════════════════════════════════════════════════
//  DEMO SEED DATA (used until real CSVs are uploaded)
// ═══════════════════════════════════════════════════════
const SEED_PLAYERS = [
  { id:1, nombre:"Hector Arango", pos:"POR", edad:28, peso:90.05, talla:194, loads:[40, 54, 305, 334, 222, 335, 396, 172, 295, 395, 60, 124, 357, 2, 342, 209, 384, 193, 267, 162, 97, 360, 361, 196], cat:{distancia:2092,playerLoad:195.5,velMax:14.9,mpm:28.1,hsr:0,sprint:0,sprintsN:0,acelsM:2,acelsH:0,decelsM:2,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:2092,playerLoad:195.5,velMax:14.9,mpm:28.1,hsr:0,sprint:0,sprintsN:0,acelsM:2,acelsH:0,decelsM:2,decelsH:0,sesiones:1}, catMes:{distancia:33442,playerLoad:2571.9,velMax:23.7,mpm:41.7,hsr:0,sprint:0,sprintsN:0,acelsM:68,acelsH:37,decelsM:69,decelsH:15,sesiones:10}, catTemporada:{distancia:73366,playerLoad:5661.4,velMax:24.4,mpm:41.2,hsr:0,sprint:0,sprintsN:0,acelsM:182,acelsH:90,decelsM:167,decelsH:37,sesiones:23}, wys:null },
  { id:2, nombre:"Johan Grisales", pos:"POR", edad:21, peso:78.6, talla:187, loads:[158, 228, 218, 461, 240, 293, 369, 167, 41, 35, 352, 366, 220, 352, 217, 401, 381, 109, 117, 410, 385, 222, 233, 162, 293, 201, 202, 216, 163, 410, 138, 221, 530, 176, 2, 235, 302, 376], cat:{distancia:5193,playerLoad:375.7,velMax:24.8,mpm:52.3,hsr:0,sprint:0,sprintsN:0,acelsM:10,acelsH:6,decelsM:2,decelsH:3,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:10243,playerLoad:912.6,velMax:24.8,mpm:43.3,hsr:0,sprint:0,sprintsN:0,acelsM:35,acelsH:19,decelsM:14,decelsH:23,sesiones:3}, catMes:{distancia:46883,playerLoad:4464.5,velMax:28.3,mpm:40.6,hsr:29,sprint:0,sprintsN:2,acelsM:202,acelsH:108,decelsM:145,decelsH:152,sesiones:17}, catTemporada:{distancia:101175,playerLoad:9598.5,velMax:29.8,mpm:46.3,hsr:102,sprint:0,sprintsN:6,acelsM:442,acelsH:246,decelsM:296,decelsH:276,sesiones:37}, wys:null },
  { id:3, nombre:"Edwin Martinez", pos:"LAT", edad:21, peso:86.3, talla:178, loads:[347, 417, 283, 506, 482, 561, 514, 334, 460, 149, 68, 400, 598, 421, 456, 1000, 288, 565, 320, 141, 984, 189, 201, 910, 150, 326, 308, 732, 289, 338, 318, 311, 913, 256, 798, 346, 856, 171, 394, 879], cat:{distancia:9413,playerLoad:878.6,velMax:32.6,mpm:94.9,hsr:358,sprint:0,sprintsN:18,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:14272,playerLoad:1443.4,velMax:32.6,mpm:78.6,hsr:423,sprint:0,sprintsN:21,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:3}, catMes:{distancia:69549,playerLoad:7234.5,velMax:32.6,mpm:69.2,hsr:1452,sprint:0,sprintsN:75,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:15}, catTemporada:{distancia:171084,playerLoad:17978.2,velMax:32.7,mpm:76.9,hsr:2767,sprint:0,sprintsN:142,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:40}, wys:null },
  { id:4, nombre:"Deivi Barrios", pos:"DC", edad:21, peso:81.6, talla:183, loads:[336, 298, 340, 523, 433, 651, 550, 286, 371, 159, 73, 305, 539, 361, 332, 812, 219, 700, 399, 134, 745, 154, 239, 787, 142, 428, 327, 766, 233, 367, 288, 343, 846, 279, 892, 405, 720, 162, 312, 884], cat:{distancia:8389,playerLoad:883.7,velMax:29.4,mpm:84.6,hsr:108,sprint:0,sprintsN:5,acelsM:10,acelsH:8,decelsM:18,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:12552,playerLoad:1357.5,velMax:29.4,mpm:70.2,hsr:108,sprint:0,sprintsN:5,acelsM:21,acelsH:8,decelsM:21,decelsH:3,sesiones:3}, catMes:{distancia:67851,playerLoad:7251.4,velMax:30.7,mpm:65.6,hsr:388,sprint:0,sprintsN:18,acelsM:102,acelsH:66,decelsM:164,decelsH:54,sesiones:15}, catTemporada:{distancia:155631,playerLoad:17140.0,velMax:30.7,mpm:68.8,hsr:962,sprint:0,sprintsN:51,acelsM:241,acelsH:137,decelsM:403,decelsH:143,sesiones:40}, wys:null },
  { id:5, nombre:"Juan Salinas", pos:"DC", edad:18, peso:93.4, talla:195, loads:[285, 345, 303, 223, 420, 413, 467, 364, 387, 185, 62, 365, 542, 411, 411, 871, 282, 573, 325, 201, 869, 237, 290, 747, 170, 322, 345, 808, 324, 430, 325, 359, 868, 236, 784, 378, 735, 138, 130, 617], cat:{distancia:6407,playerLoad:616.8,velMax:31.0,mpm:85.5,hsr:76,sprint:0,sprintsN:5,acelsM:16,acelsH:12,decelsM:8,decelsH:3,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:8808,playerLoad:884.5,velMax:31.0,mpm:63.6,hsr:76,sprint:0,sprintsN:5,acelsM:19,acelsH:13,decelsM:15,decelsH:6,sesiones:3}, catMes:{distancia:66804,playerLoad:6797.8,velMax:34.4,mpm:66.2,hsr:506,sprint:0,sprintsN:28,acelsM:178,acelsH:98,decelsM:134,decelsH:57,sesiones:15}, catTemporada:{distancia:158726,playerLoad:16545.6,velMax:34.4,mpm:69.8,hsr:1399,sprint:0,sprintsN:83,acelsM:415,acelsH:244,decelsM:396,decelsH:171,sesiones:40}, wys:null },
  { id:6, nombre:"Victor Lasso", pos:"DC", edad:20, peso:74.2, talla:188, loads:[390, 385, 584, 361, 484, 363, 446, 369, 254, 308, 277, 436, 491, 479, 775], cat:{distancia:6762,playerLoad:775.4,velMax:32.2,mpm:95.8,hsr:163,sprint:0,sprintsN:10,acelsM:12,acelsH:10,decelsM:13,decelsH:9,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:15003,playerLoad:1745.8,velMax:32.2,mpm:75.1,hsr:291,sprint:0,sprintsN:17,acelsM:30,acelsH:16,decelsM:50,decelsH:25,sesiones:3}, catMes:{distancia:54082,playerLoad:6403.4,velMax:32.4,mpm:76.3,hsr:572,sprint:0,sprintsN:32,acelsM:117,acelsH:69,decelsM:169,decelsH:78,sesiones:15}, catTemporada:{distancia:54082,playerLoad:6403.4,velMax:32.4,mpm:76.3,hsr:572,sprint:0,sprintsN:32,acelsM:117,acelsH:69,decelsM:169,decelsH:78,sesiones:15}, wys:null },
  { id:7, nombre:"Nawer Vargas", pos:"DC", edad:21, peso:88.2, talla:196, loads:[268, 345, 338, 547, 401, 494, 507, 336, 288, 153, 62, 226, 547, 301, 175, 208, 270, 601, 333, 184, 828, 234, 264, 772, 130, 350, 322, 658, 316, 423, 319, 183, 276, 551, 217, 371, 340], cat:{distancia:3683,playerLoad:339.9,velMax:27.6,mpm:49.6,hsr:48,sprint:0,sprintsN:1,acelsM:4,acelsH:3,decelsM:8,decelsH:4,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:7768,playerLoad:710.6,velMax:27.6,mpm:61.7,hsr:48,sprint:0,sprintsN:1,acelsM:9,acelsH:7,decelsM:27,decelsH:13,sesiones:2}, catMes:{distancia:46090,playerLoad:4325.7,velMax:32.5,mpm:67.5,hsr:354,sprint:0,sprintsN:16,acelsM:90,acelsH:77,decelsM:234,decelsH:169,sesiones:12}, catTemporada:{distancia:137522,playerLoad:13138.1,velMax:32.5,mpm:75.3,hsr:1030,sprint:0,sprintsN:57,acelsM:193,acelsH:139,decelsM:596,decelsH:288,sesiones:37}, wys:null },
  { id:8, nombre:"Felipe Palomino", pos:"LAT", edad:21, peso:80.5, talla:185, loads:[934, 319, 491, 205, 150, 607, 182, 805, 249, 261, 800, 276, 313, 309, 688, 286, 581, 432, 786, 139, 338, 703], cat:{distancia:6871,playerLoad:703.3,velMax:30.9,mpm:91.7,hsr:146,sprint:0,sprintsN:6,acelsM:20,acelsH:10,decelsM:13,decelsH:6,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:11553,playerLoad:1181.0,velMax:30.9,mpm:76.3,hsr:174,sprint:0,sprintsN:8,acelsM:31,acelsH:11,decelsM:18,decelsH:11,sesiones:3}, catMes:{distancia:60058,playerLoad:6163.9,velMax:31.7,mpm:77.6,hsr:919,sprint:0,sprintsN:48,acelsM:123,acelsH:76,decelsM:135,decelsH:74,sesiones:14}, catTemporada:{distancia:97923,playerLoad:9856.2,velMax:34.0,mpm:77.1,hsr:1571,sprint:0,sprintsN:81,acelsM:211,acelsH:146,decelsM:233,decelsH:110,sesiones:22}, wys:null },
  { id:9, nombre:"Jhon Barreiro", pos:"LAT", edad:20, peso:77.4, talla:186, loads:[317, 415, 295, 360, 460, 344, 474, 349, 358, 154, 58, 401, 607, 292, 431, 857, 353, 475, 354, 113, 758, 194, 239, 780, 338, 315, 913, 274, 451, 347, 361, 911, 258, 374, 422, 511, 192, 684, 158, 400, 795], cat:{distancia:8764,playerLoad:794.7,velMax:31.8,mpm:88.3,hsr:269,sprint:0,sprintsN:14,acelsM:12,acelsH:5,decelsM:18,decelsH:6,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:13963,playerLoad:1352.2,velMax:31.8,mpm:77.1,hsr:303,sprint:0,sprintsN:15,acelsM:19,acelsH:7,decelsM:29,decelsH:11,sesiones:3}, catMes:{distancia:76931,playerLoad:7703.2,velMax:32.4,mpm:67.9,hsr:1124,sprint:0,sprintsN:59,acelsM:142,acelsH:94,decelsM:184,decelsH:71,sesiones:17}, catTemporada:{distancia:171439,playerLoad:17141.8,velMax:32.8,mpm:75.2,hsr:2335,sprint:0,sprintsN:115,acelsM:311,acelsH:196,decelsM:365,decelsH:142,sesiones:41}, wys:null },
  { id:10, nombre:"Samuel Gonzalez", pos:"LAT", edad:21, peso:71.5, talla:179, loads:[140, 87, 375, 517, 213, 248, 556, 238, 350, 684, 322, 160, 359, 225, 267, 283, 327, 312, 319, 442, 336, 176, 293, 460, 251, 411, 337], cat:{distancia:3042,playerLoad:336.5,velMax:33.1,mpm:40.9,hsr:113,sprint:0,sprintsN:3,acelsM:4,acelsH:4,decelsM:12,decelsH:5,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:6909,playerLoad:747.8,velMax:33.1,mpm:55.4,hsr:123,sprint:0,sprintsN:4,acelsM:7,acelsH:7,decelsM:26,decelsH:10,sesiones:2}, catMes:{distancia:28997,playerLoad:3336.1,velMax:33.1,mpm:58.9,hsr:225,sprint:0,sprintsN:12,acelsM:47,acelsH:31,decelsM:92,decelsH:33,sesiones:10}, catTemporada:{distancia:79633,playerLoad:8686.5,velMax:33.1,mpm:67.6,hsr:982,sprint:0,sprintsN:47,acelsM:116,acelsH:66,decelsM:186,decelsH:77,sesiones:27}, wys:null },
  { id:11, nombre:"Jerson Balanta", pos:"LAT", edad:17, peso:73.5, talla:182, loads:[267, 308, 293, 222, 352, 431, 247, 226, 133, 64, 409, 519, 311, 181, 503, 234, 305, 582, 330, 133, 234, 322, 298, 291, 318, 492, 319, 439, 295, 314, 372, 293, 380, 354, 148, 325], cat:{distancia:3353,playerLoad:325.1,velMax:24.5,mpm:60.5,hsr:0,sprint:0,sprintsN:0,acelsM:9,acelsH:4,decelsM:12,decelsH:6,actividad:"SESIÓN 39",fecha:"2026-03-03"}, catSemana:{distancia:3353,playerLoad:325.1,velMax:24.5,mpm:60.5,hsr:0,sprint:0,sprintsN:0,acelsM:9,acelsH:4,decelsM:12,decelsH:6,sesiones:1}, catMes:{distancia:42734,playerLoad:4340.2,velMax:32.2,mpm:70.5,hsr:410,sprint:0,sprintsN:21,acelsM:95,acelsH:43,decelsM:159,decelsH:38,sesiones:13}, catTemporada:{distancia:111032,playerLoad:11243.2,velMax:32.2,mpm:71.7,hsr:1325,sprint:0,sprintsN:71,acelsM:227,acelsH:95,decelsM:474,decelsH:137,sesiones:36}, wys:null },
  { id:12, nombre:"Luis Mosquera", pos:"LAT", edad:19, peso:71.6, talla:175, loads:[411, 451, 324, 371, 482, 415, 624, 364, 430, 166, 87, 429, 654, 414, 433, 454, 261, 461, 650, 408, 128, 294, 233, 283, 340, 336, 165, 465, 364, 512, 374, 357, 523, 188, 339, 680, 4], cat:{distancia:7288,playerLoad:680.4,velMax:28.9,mpm:95.3,hsr:55,sprint:0,sprintsN:4,acelsM:4,acelsH:6,decelsM:16,decelsH:8,actividad:"FECHA 5 VS REAL CUNDINAMARCA",fecha:"2026-02-22"}, catSemana:null, catMes:{distancia:39594,playerLoad:4301.6,velMax:32.2,mpm:70.3,hsr:551,sprint:0,sprintsN:32,acelsM:61,acelsH:46,decelsM:135,decelsH:53,sesiones:11}, catTemporada:{distancia:129409,playerLoad:13868.4,velMax:32.2,mpm:84.1,hsr:1528,sprint:0,sprintsN:83,acelsM:181,acelsH:133,decelsM:359,decelsH:126,sesiones:36}, wys:null },
  { id:13, nombre:"Santiago Agamez", pos:"MCD", edad:20, peso:73.2, talla:177, loads:[347, 363, 381, 299, 520, 569, 533, 409, 493, 137, 74, 415, 784, 406, 420, 602, 283, 385, 411, 169, 703, 228, 268, 867, 126, 368, 333, 756, 443, 427, 345, 1092, 885, 397, 569, 196, 642, 146, 428, 1021], cat:{distancia:9679,playerLoad:1021.2,velMax:28.2,mpm:97.6,hsr:60,sprint:0,sprintsN:3,acelsM:9,acelsH:8,decelsM:6,decelsH:7,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:14775,playerLoad:1595.5,velMax:28.2,mpm:79.2,hsr:65,sprint:0,sprintsN:3,acelsM:12,acelsH:10,decelsM:13,decelsH:9,sesiones:3}, catMes:{distancia:73133,playerLoad:8047.7,velMax:31.8,mpm:68.1,hsr:465,sprint:0,sprintsN:24,acelsM:99,acelsH:80,decelsM:120,decelsH:39,sesiones:15}, catTemporada:{distancia:161152,playerLoad:18239.1,velMax:31.8,mpm:74.0,hsr:764,sprint:0,sprintsN:41,acelsM:258,acelsH:171,decelsM:294,decelsH:81,sesiones:40}, wys:null },
  { id:14, nombre:"Dennis Matamba", pos:"MCD", edad:20, peso:79.7, talla:184, loads:[345, 365, 178, 410, 484, 447, 311, 383, 130, 73, 344, 461, 140, 208, 127, 317, 594, 329, 176, 369, 180, 191, 274, 337, 226, 337, 471, 380, 435, 318, 198, 242, 348, 260, 394, 398, 294], cat:{distancia:3174,playerLoad:293.6,velMax:26.4,mpm:113.5,hsr:6,sprint:0,sprintsN:0,acelsM:1,acelsH:1,decelsM:4,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:11529,playerLoad:1085.6,velMax:26.4,mpm:81.8,hsr:6,sprint:0,sprintsN:0,acelsM:7,acelsH:6,decelsM:21,decelsH:11,sesiones:3}, catMes:{distancia:44073,playerLoad:4302.7,velMax:27.0,mpm:72.8,hsr:99,sprint:0,sprintsN:7,acelsM:42,acelsH:19,decelsM:90,decelsH:40,sesiones:13}, catTemporada:{distancia:119116,playerLoad:11475.3,velMax:32.2,mpm:76.2,hsr:693,sprint:0,sprintsN:37,acelsM:110,acelsH:56,decelsM:244,decelsH:100,sesiones:37}, wys:null },
  { id:15, nombre:"Yeiner Valoyes", pos:"MCI", edad:20, peso:68.0, talla:170, loads:[403, 457, 403, 264, 609, 505, 345, 315, 360, 188, 55, 403, 547, 347, 271, 665, 276, 391, 734, 453, 280, 435, 295, 358, 363, 465, 327, 404, 564, 270, 521, 449, 228, 243, 355, 110, 516, 444], cat:{distancia:4052,playerLoad:444.0,velMax:31.4,mpm:54.5,hsr:99,sprint:0,sprintsN:7,acelsM:9,acelsH:5,decelsM:8,decelsH:4,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:8212,playerLoad:960.3,velMax:31.4,mpm:64.8,hsr:107,sprint:0,sprintsN:7,acelsM:19,acelsH:18,decelsM:17,decelsH:6,sesiones:2}, catMes:{distancia:36574,playerLoad:4432.1,velMax:31.5,mpm:63.1,hsr:349,sprint:0,sprintsN:17,acelsM:73,acelsH:79,decelsM:85,decelsH:36,sesiones:12}, catTemporada:{distancia:115186,playerLoad:14619.0,velMax:31.7,mpm:73.0,hsr:1270,sprint:0,sprintsN:62,acelsM:308,acelsH:229,decelsM:241,decelsH:96,sesiones:38}, wys:null },
  { id:16, nombre:"Kevin Gomez", pos:"MCI", edad:30, peso:72.8, talla:170, loads:[393, 420, 359, 486, 610, 476, 415, 318, 284, 181, 69, 380, 667, 233, 295, 214, 606, 378, 247, 329, 172, 327, 451, 456, 425, 403, 271, 618, 486, 472, 406, 225, 286, 348, 550, 301], cat:{distancia:2591,playerLoad:301.5,velMax:20.4,mpm:34.9,hsr:0,sprint:0,sprintsN:0,acelsM:2,acelsH:1,decelsM:8,decelsH:2,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:6800,playerLoad:851.7,velMax:22.3,mpm:55.4,hsr:0,sprint:0,sprintsN:0,acelsM:11,acelsH:3,decelsM:23,decelsH:11,sesiones:2}, catMes:{distancia:37384,playerLoad:4791.5,velMax:26.0,mpm:64.6,hsr:19,sprint:0,sprintsN:1,acelsM:63,acelsH:41,decelsM:114,decelsH:48,sesiones:12}, catTemporada:{distancia:105527,playerLoad:13558.1,velMax:27.3,mpm:72.8,hsr:221,sprint:0,sprintsN:13,acelsM:154,acelsH:100,decelsM:248,decelsH:103,sesiones:36}, wys:null },
  { id:17, nombre:"Jhoiner Zarante", pos:"MCI", edad:18, peso:76.8, talla:178, loads:[297, 334, 232, 502, 563, 505, 348, 406, 116, 71, 385, 621, 365, 324, 878, 220, 137, 394, 187, 184, 266, 327, 274, 115, 386, 393, 313, 160, 273, 287, 297, 98, 361, 274, 256], cat:{distancia:2683,playerLoad:255.7,velMax:26.4,mpm:111.9,hsr:15,sprint:0,sprintsN:1,acelsM:3,acelsH:6,decelsM:5,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:9758,playerLoad:891.2,velMax:27.9,mpm:75.0,hsr:37,sprint:0,sprintsN:2,acelsM:17,acelsH:13,decelsM:36,decelsH:10,sesiones:3}, catMes:{distancia:35537,playerLoad:3487.0,velMax:27.9,mpm:60.7,hsr:113,sprint:0,sprintsN:6,acelsM:59,acelsH:34,decelsM:116,decelsH:41,sesiones:13}, catTemporada:{distancia:115339,playerLoad:11147.2,velMax:28.4,mpm:69.7,hsr:386,sprint:0,sprintsN:22,acelsM:168,acelsH:107,decelsM:321,decelsH:118,sesiones:35}, wys:null },
  { id:18, nombre:"Jader Contreras", pos:"MCO", edad:18, peso:70.9, talla:178, loads:[379, 422, 462, 267, 583, 528, 513, 402, 537, 135, 39, 366, 755, 304, 357, 110, 293, 178, 98, 218, 211, 421, 272, 115, 492, 335, 453, 315, 176, 263, 363, 498, 153, 460], cat:{distancia:4117,playerLoad:460.4,velMax:23.6,mpm:74.3,hsr:0,sprint:0,sprintsN:0,acelsM:14,acelsH:6,decelsM:16,decelsH:2,actividad:"SESIÓN 39",fecha:"2026-03-03"}, catSemana:{distancia:4117,playerLoad:460.4,velMax:23.6,mpm:74.3,hsr:0,sprint:0,sprintsN:0,acelsM:14,acelsH:6,decelsM:16,decelsH:2,sesiones:1}, catMes:{distancia:36354,playerLoad:3894.3,velMax:27.5,mpm:57.8,hsr:46,sprint:0,sprintsN:1,acelsM:77,acelsH:40,decelsM:109,decelsH:57,sesiones:12}, catTemporada:{distancia:105148,playerLoad:11473.0,velMax:27.5,mpm:69.7,hsr:387,sprint:0,sprintsN:22,acelsM:221,acelsH:132,decelsM:368,decelsH:148,sesiones:34}, wys:null },
  { id:19, nombre:"Josue Villareal", pos:"MCO", edad:19, peso:75.2, talla:183, loads:[269, 375, 170, 521, 249, 149, 52, 404, 597, 347, 236, 198, 286, 293, 39, 121, 264, 146, 171, 65, 227, 134, 188, 97, 186, 105, 291, 4, 399, 280], cat:{distancia:2660,playerLoad:280.4,velMax:24.2,mpm:35.8,hsr:0,sprint:0,sprintsN:0,acelsM:7,acelsH:4,decelsM:11,decelsH:5,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:6339,playerLoad:679.5,velMax:24.2,mpm:51.1,hsr:0,sprint:0,sprintsN:0,acelsM:11,acelsH:10,decelsM:29,decelsH:12,sesiones:2}, catMes:{distancia:18471,playerLoad:2144.4,velMax:24.7,mpm:40.7,hsr:0,sprint:0,sprintsN:0,acelsM:41,acelsH:19,decelsM:60,decelsH:35,sesiones:11}, catTemporada:{distancia:62212,playerLoad:6861.3,velMax:28.9,mpm:55.0,hsr:261,sprint:0,sprintsN:15,acelsM:116,acelsH:55,decelsM:137,decelsH:64,sesiones:29}, wys:null },
  { id:20, nombre:"Maicol Preciado", pos:"EXT", edad:20, peso:69.0, talla:174, loads:[377, 420, 426, 289, 554, 499, 545, 393, 332, 155, 78, 425, 472, 302, 312, 300, 383, 617, 349, 155, 233, 291, 419, 365, 341, 143, 597, 291, 0, 269, 525, 90, 391], cat:{distancia:3559,playerLoad:391.2,velMax:27.1,mpm:64.2,hsr:16,sprint:0,sprintsN:1,acelsM:2,acelsH:6,decelsM:10,decelsH:6,actividad:"SESIÓN 39",fecha:"2026-03-03"}, catSemana:{distancia:3559,playerLoad:391.2,velMax:27.1,mpm:64.2,hsr:16,sprint:0,sprintsN:1,acelsM:2,acelsH:6,decelsM:10,decelsH:6,sesiones:1}, catMes:{distancia:22241,playerLoad:2647.6,velMax:27.1,mpm:45.3,hsr:34,sprint:0,sprintsN:2,acelsM:22,acelsH:17,decelsM:48,decelsH:19,sesiones:8}, catTemporada:{distancia:93661,playerLoad:11338.5,velMax:32.2,mpm:67.3,hsr:546,sprint:0,sprintsN:33,acelsM:100,acelsH:82,decelsM:197,decelsH:86,sesiones:32}, wys:null },
  { id:21, nombre:"Andres Ruiz", pos:"MCI", edad:21, peso:68.0, talla:170, loads:[273, 495, 509, 112, 530, 335, 279, 141, 75, 396, 397, 349, 1031, 314, 443, 165, 191, 169, 127, 269, 343, 337, 304, 704, 356, 507, 367, 392, 860, 199, 719, 426, 846, 153, 435, 1108], cat:{distancia:10880,playerLoad:1108.1,velMax:29.7,mpm:109.7,hsr:96,sprint:0,sprintsN:4,acelsM:19,acelsH:9,decelsM:13,decelsH:5,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:16570,playerLoad:1695.8,velMax:30.3,mpm:85.2,hsr:249,sprint:0,sprintsN:9,acelsM:26,acelsH:9,decelsM:24,decelsH:7,sesiones:3}, catMes:{distancia:76031,playerLoad:7711.8,velMax:32.2,mpm:79.2,hsr:1023,sprint:0,sprintsN:48,acelsM:144,acelsH:80,decelsM:143,decelsH:60,sesiones:15}, catTemporada:{distancia:142753,playerLoad:14654.2,velMax:32.2,mpm:76.8,hsr:1954,sprint:0,sprintsN:88,acelsM:273,acelsH:149,decelsM:286,decelsH:117,sesiones:36}, wys:null },
  { id:22, nombre:"Eder Torres", pos:"MCI", edad:16, peso:68.3, talla:172, loads:[371, 429, 460, 247, 564, 561, 539, 382, 286, 158, 62, 467, 774, 366, 473, 448, 389, 657, 397, 161, 594, 177, 209, 342, 318, 125, 639, 431, 595, 354, 336, 208, 355, 458, 175, 441, 323, 322], cat:{distancia:2776,playerLoad:322.1,velMax:29.1,mpm:115.8,hsr:19,sprint:0,sprintsN:1,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:9483,playerLoad:1086.3,velMax:29.1,mpm:74.5,hsr:38,sprint:0,sprintsN:2,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:3}, catMes:{distancia:41072,playerLoad:5081.5,velMax:30.1,mpm:65.6,hsr:123,sprint:0,sprintsN:5,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:14}, catTemporada:{distancia:119283,playerLoad:14595.8,velMax:30.1,mpm:73.7,hsr:773,sprint:0,sprintsN:41,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:38}, wys:null },
  { id:23, nombre:"Sebastian Girado", pos:"EXT", edad:21, peso:68.0, talla:168, loads:[316, 202, 205, 479, 495, 567, 357, 381, 141, 115, 440, 627, 354, 413, 757, 364, 661, 305, 156, 834, 182, 217, 883, 150, 353, 274, 836, 249, 518, 371, 354, 693, 2, 402, 370, 823, 154, 429, 742], cat:{distancia:7201,playerLoad:741.7,velMax:30.7,mpm:88.5,hsr:113,sprint:0,sprintsN:7,acelsM:21,acelsH:16,decelsM:13,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:12486,playerLoad:1325.7,velMax:30.7,mpm:76.8,hsr:148,sprint:0,sprintsN:9,acelsM:32,acelsH:20,decelsM:20,decelsH:6,sesiones:3}, catMes:{distancia:62431,playerLoad:6567.7,velMax:32.4,mpm:70.8,hsr:781,sprint:0,sprintsN:41,acelsM:127,acelsH:110,decelsM:87,decelsH:40,sesiones:14}, catTemporada:{distancia:152379,playerLoad:16170.3,velMax:32.4,mpm:74.0,hsr:1740,sprint:0,sprintsN:96,acelsM:352,acelsH:254,decelsM:266,decelsH:106,sesiones:38}, wys:null },
  { id:24, nombre:"Johan Parra", pos:"EXT", edad:21, peso:63.0, talla:167, loads:[528, 280, 498, 428, 409, 357, 560, 146, 76, 559, 498, 124, 407, 817, 483, 156, 466, 232, 291, 372, 435, 412, 111, 602, 434, 435, 694, 360, 418, 675, 226, 302, 376, 567, 641, 170, 513, 392], cat:{distancia:3287,playerLoad:392.2,velMax:28.2,mpm:117.6,hsr:132,sprint:0,sprintsN:4,acelsM:8,acelsH:8,decelsM:3,decelsH:1,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:8998,playerLoad:1075.1,velMax:30.7,mpm:88.9,hsr:304,sprint:0,sprintsN:12,acelsM:15,acelsH:17,decelsM:10,decelsH:5,sesiones:3}, catMes:{distancia:58622,playerLoad:7327.1,velMax:34.0,mpm:77.3,hsr:1457,sprint:0,sprintsN:71,acelsM:193,acelsH:136,decelsM:107,decelsH:43,sesiones:17}, catTemporada:{distancia:124275,playerLoad:15448.8,velMax:34.0,mpm:80.4,hsr:2919,sprint:0,sprintsN:150,acelsM:374,acelsH:242,decelsM:278,decelsH:96,sesiones:38}, wys:null },
  { id:25, nombre:"Jose Hernandez", pos:"EXT", edad:17, peso:71.3, talla:173, loads:[415, 449, 452, 248, 629, 571, 642, 425, 165, 48, 484, 795, 400, 536, 885, 376, 844, 370, 207, 886, 230, 378, 918, 143, 305, 113, 635, 401, 622, 350, 427, 193, 286, 525, 273, 504, 320, 876], cat:{distancia:7707,playerLoad:875.6,velMax:32.9,mpm:108.3,hsr:190,sprint:0,sprintsN:6,acelsM:8,acelsH:5,decelsM:13,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, catSemana:{distancia:14412,playerLoad:1699.8,velMax:32.9,mpm:72.5,hsr:233,sprint:0,sprintsN:9,acelsM:22,acelsH:8,decelsM:35,decelsH:16,sesiones:3}, catMes:{distancia:46094,playerLoad:5830.2,velMax:33.8,mpm:66.0,hsr:629,sprint:0,sprintsN:26,acelsM:75,acelsH:36,decelsM:122,decelsH:55,sesiones:14}, catTemporada:{distancia:137446,playerLoad:17323.8,velMax:33.8,mpm:74.7,hsr:2197,sprint:0,sprintsN:117,acelsM:235,acelsH:117,decelsM:369,decelsH:160,sesiones:38}, wys:null },
  { id:26, nombre:"Faver Aragon", pos:"EXT", edad:20, peso:74.9, talla:178, loads:[310, 347, 364, 230, 476, 382, 298, 266, 426, 162, 63, 342, 579, 211, 255, 616, 252, 197, 432, 142, 227, 309, 322, 295, 288, 491, 277, 521, 314, 183, 228, 350, 101, 395, 273], cat:{distancia:2609,playerLoad:272.7,velMax:25.5,mpm:35.1,hsr:3,sprint:0,sprintsN:0,acelsM:2,acelsH:1,decelsM:9,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:6614,playerLoad:667.2,velMax:28.1,mpm:53.7,hsr:25,sprint:0,sprintsN:2,acelsM:5,acelsH:2,decelsM:16,decelsH:6,sesiones:2}, catMes:{distancia:35861,playerLoad:3713.1,velMax:30.8,mpm:63.3,hsr:197,sprint:0,sprintsN:9,acelsM:45,acelsH:24,decelsM:68,decelsH:31,sesiones:12}, catTemporada:{distancia:105363,playerLoad:10922.1,velMax:33.0,mpm:71.4,hsr:1284,sprint:0,sprintsN:69,acelsM:156,acelsH:75,decelsM:210,decelsH:74,sesiones:35}, wys:null },
  { id:27, nombre:"Daniel Lourido", pos:"EXT", edad:21, peso:58.7, talla:170, loads:[356, 407, 397, 258, 375, 420, 356, 241, 223, 158, 111, 384, 635, 180, 325, 675, 315, 189, 420, 227, 289, 313, 379, 238, 271, 556, 301, 464, 321, 183, 281, 459, 193, 414, 273], cat:{distancia:2374,playerLoad:272.9,velMax:26.9,mpm:31.9,hsr:40,sprint:0,sprintsN:2,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, catSemana:{distancia:6251,playerLoad:686.8,velMax:26.9,mpm:51.0,hsr:40,sprint:0,sprintsN:2,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:2}, catMes:{distancia:35309,playerLoad:3953.5,velMax:30.6,mpm:61.7,hsr:368,sprint:0,sprintsN:19,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:12}, catTemporada:{distancia:101740,playerLoad:11587.6,velMax:32.7,mpm:70.5,hsr:1128,sprint:0,sprintsN:56,acelsM:0,acelsH:0,decelsM:0,decelsH:0,sesiones:35}, wys:null },
  { id:28, nombre:"Santiago Arrechea", pos:"DEL", edad:19, peso:85.5, talla:181, loads:[367, 424, 468, 285, 521, 716, 624, 336, 566, 193, 131, 461, 655, 397, 275, 936, 350, 635, 398, 185, 172, 144, 209, 354, 413, 354, 765, 391, 508, 455, 440, 910, 385, 1015, 665], cat:{distancia:6373,playerLoad:664.6,velMax:30.1,mpm:84.9,hsr:98,sprint:0,sprintsN:4,acelsM:9,acelsH:8,decelsM:13,decelsH:4,actividad:"FECHA 7 VS ENVIGADO FC 2026-1",fecha:"2026-03-01"}, catSemana:null, catMes:{distancia:54401,playerLoad:6299.9,velMax:33.0,mpm:77.8,hsr:702,sprint:0,sprintsN:37,acelsM:105,acelsH:61,decelsM:104,decelsH:33,sesiones:11}, catTemporada:{distancia:133690,playerLoad:16103.7,velMax:33.0,mpm:77.0,hsr:1708,sprint:0,sprintsN:88,acelsM:246,acelsH:139,decelsM:299,decelsH:88,sesiones:35}, wys:null },
  { id:29, nombre:"Sergio Martinez", pos:"DEL", edad:17, peso:74.6, talla:179, loads:[665, 324, 202, 219, 292, 599, 152, 306, 126, 467, 364, 26, 0, 559, 318, 332, 276, 185, 338, 472], cat:{distancia:3594,playerLoad:472.5,velMax:25.0,mpm:76.0,hsr:2,sprint:0,sprintsN:0,acelsM:13,acelsH:3,decelsM:22,decelsH:8,actividad:"25 feb. M8 S34 EJECUCIÓN",fecha:"2026-02-25"}, catSemana:null, catMes:{distancia:31772,playerLoad:3744.1,velMax:31.2,mpm:61.2,hsr:313,sprint:0,sprintsN:14,acelsM:78,acelsH:39,decelsM:71,decelsH:38,sesiones:11}, catTemporada:{distancia:54088,playerLoad:6197.4,velMax:31.2,mpm:67.3,hsr:599,sprint:0,sprintsN:31,acelsM:118,acelsH:63,decelsM:113,decelsH:62,sesiones:18}, wys:null },
];

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbws-dAve2aw71GZhGA58PnNdPY8H3HFqWfLsyHzqyQ5xjPIpyxarmtoyuZJXMbu--pV/exec";
const GPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbykIhkZWn3CuYqETRgb9HQBR2dRBdj8r43b4czbTLQ-tDXRwDg6Q4WWVRJpKsmOqZ6hrQ/exec";

const SEED_WELLNESS = [
  { jugador:"Hector Arango", sueno:5, fatiga:4, dolor:3, humor:6, estres:6, rpe:8 },
  { jugador:"Johan Grisales", sueno:5, fatiga:4, dolor:1, humor:5, estres:5, rpe:9 },
  { jugador:"Edwin Martinez", sueno:8, fatiga:4, dolor:3, humor:7, estres:1, rpe:7 },
  { jugador:"Deivi Barrios", sueno:6, fatiga:2, dolor:4, humor:7, estres:3, rpe:9 },
  { jugador:"Juan Salinas", sueno:7, fatiga:6, dolor:4, humor:6, estres:4, rpe:5 },
  { jugador:"Victor Lasso", sueno:9, fatiga:4, dolor:2, humor:5, estres:4, rpe:7 },
  { jugador:"Nawer Vargas", sueno:5, fatiga:6, dolor:3, humor:5, estres:3, rpe:6 },
  { jugador:"Felipe Palomino", sueno:9, fatiga:1, dolor:2, humor:8, estres:6, rpe:5 },
  { jugador:"Jhon Barreiro", sueno:9, fatiga:7, dolor:1, humor:7, estres:2, rpe:6 },
  { jugador:"Samuel Gonzalez", sueno:7, fatiga:5, dolor:4, humor:9, estres:2, rpe:6 },
  { jugador:"Jerson Balanta", sueno:6, fatiga:3, dolor:1, humor:6, estres:2, rpe:7 },
  { jugador:"Luis Mosquera", sueno:9, fatiga:5, dolor:4, humor:9, estres:6, rpe:5 },
  { jugador:"Santiago Agamez", sueno:6, fatiga:5, dolor:1, humor:6, estres:1, rpe:5 },
  { jugador:"Dennis Matamba", sueno:5, fatiga:4, dolor:5, humor:8, estres:4, rpe:8 },
  { jugador:"Yeiner Valoyes", sueno:7, fatiga:7, dolor:5, humor:8, estres:4, rpe:7 },
  { jugador:"Kevin Gomez", sueno:8, fatiga:1, dolor:5, humor:5, estres:1, rpe:5 },
  { jugador:"Jhoiner Zarante", sueno:6, fatiga:3, dolor:4, humor:5, estres:6, rpe:9 },
  { jugador:"Jader Contreras", sueno:5, fatiga:6, dolor:3, humor:7, estres:4, rpe:8 },
  { jugador:"Josue Villareal", sueno:8, fatiga:7, dolor:5, humor:6, estres:2, rpe:6 },
  { jugador:"Maicol Preciado", sueno:9, fatiga:1, dolor:2, humor:6, estres:1, rpe:6 },
  { jugador:"Andres Ruiz", sueno:6, fatiga:4, dolor:2, humor:7, estres:1, rpe:6 },
  { jugador:"Eder Torres", sueno:9, fatiga:3, dolor:2, humor:7, estres:5, rpe:5 },
  { jugador:"Sebastian Girado", sueno:8, fatiga:7, dolor:5, humor:6, estres:4, rpe:8 },
  { jugador:"Johan Parra", sueno:6, fatiga:4, dolor:1, humor:6, estres:4, rpe:8 },
  { jugador:"Jose Hernandez", sueno:5, fatiga:1, dolor:1, humor:7, estres:3, rpe:6 },
  { jugador:"Faver Aragon", sueno:9, fatiga:3, dolor:2, humor:9, estres:6, rpe:9 },
  { jugador:"Daniel Lourido", sueno:6, fatiga:4, dolor:3, humor:7, estres:5, rpe:8 },
  { jugador:"Santiago Arrechea", sueno:7, fatiga:1, dolor:5, humor:6, estres:5, rpe:8 },
  { jugador:"Sergio Martinez", sueno:9, fatiga:2, dolor:5, humor:6, estres:2, rpe:9 },
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
  const [wellnessData, setWellnessData] = useState(SEED_WELLNESS);
  const [wellnessLoading, setWellnessLoading] = useState(false);
  const [catRaw, setCatRaw]       = useState(null);   // raw catapult rows
  const [wysRaw, setWysRaw]       = useState(null);   // raw wyscout rows
  const [loading, setLoading]     = useState({});
  const [flash, setFlash]         = useState(null);   // { msg, color }
  const [selPlayer, setSelPlayer] = useState(null);
  const [gpsPeriod, setGpsPeriod] = useState('ultima');
  const [gConnected, setGConnected] = useState(false);
  const [gpsConnected, setGpsConnected] = useState(false);
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
        // Filtrar nulls (filas de período que no son sesión completa)
        const rows = parseCSV(e.target.result).map(mapCatapult).filter(Boolean);
        setCatRaw(rows);
        // Merge into players: match por apellido o primer nombre (case-insensitive)
        setPlayers(prev => prev.map(p => {
          const nameParts = p.nombre.toLowerCase().split(" ");
          const match = rows.find(r => {
            const rName = r.jugador.toLowerCase();
            // Buscar cualquier parte del nombre del jugador en el nombre del CSV
            return nameParts.some(part => part.length > 2 && rName.includes(part));
          });
          if (!match) return p;
          // Usar Player Load como carga diaria, o distancia/100 como fallback
          const cargaDia = match.playerLoad > 0 ? match.playerLoad : match.distancia / 100;
          const newLoads = [...p.loads, Math.round(cargaDia)].slice(-28);
          return { ...p, loads: newLoads, cat: match };
        }));
        setLoading(l=>({...l,cat:false}));
        const matched = rows.filter(r => r.jugador && r.jugador !== "—").length;
        showFlash(`✓ Catapult cargado · ${matched} jugadores · ${rows.length} registros`);
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

  // ── Fetch Wellness desde Apps Script ──
  const fetchWellness = useCallback(async (silent=false) => {
    if (!silent) setWellnessLoading(true);
    try {
      const res = await fetch(`${APPS_SCRIPT_URL}?tipo=wellness`);
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const byPlayer = {};
        rows.forEach(r => {
          const nombre = r.Jugador || r.jugador;
          if (!nombre || nombre === 'Test') return;
          const ts = r.Timestamp || r.timestamp || '';
          if (!byPlayer[nombre] || ts > (byPlayer[nombre]._ts||'')) {
            byPlayer[nombre] = {
              jugador: nombre,
              sueno:   parseFloat(r["Sueño"]  || r.sueno  || 5),
              fatiga:  parseFloat(r.Fatiga    || r.fatiga  || 3),
              dolor:   parseFloat(r.Dolor     || r.dolor   || 2),
              humor:   parseFloat(r.Humor     || r.humor   || 7),
              estres:  parseFloat(r["Estrés"] || r.estres  || 3),
              fecha:   r.Fecha || r.fecha || '',
              _ts: ts,
            };
          }
        });
        const merged = SEED_WELLNESS.map(s => byPlayer[s.jugador] || s);
        Object.values(byPlayer).forEach(b => {
          if (!merged.find(m => m.jugador === b.jugador)) merged.push(b);
        });
        setWellnessData(merged);
        setGConnected(true);
        if (!silent) showFlash(`✓ Wellness actualizado · ${Object.keys(byPlayer).length} jugadores`, C.purple);
      } else {
        if (!silent) showFlash("⚠ Sin datos en el Sheet aún", C.yellow);
      }
    } catch(e) {
      if (!silent) showFlash("⚠ Error conectando al Sheet", C.red);
    }
    if (!silent) setWellnessLoading(false);
  }, []);

  // ── Fetch GPS desde Sheet ──
  const fetchGPS = useCallback(async (silent=false) => {
    try {
      const res = await fetch(`${GPS_SCRIPT_URL}?tipo=gps`);
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        const pf = v => { const n = parseFloat(String(v).replace(',','.')); return isNaN(n) ? 0 : n; };
        const byPlayer = {};
        rows.forEach(r => {
          const nombre = (r.Jugador || '').trim();
          if (!nombre) return;
          const fecha = String(r.Fecha || '');
          if (!byPlayer[nombre] || fecha > String(byPlayer[nombre].Fecha || '')) {
            byPlayer[nombre] = r;
          }
        });
        setPlayers(prev => prev.map(p => {
          const nameParts = p.nombre.toLowerCase().split(" ").filter(x => x.length > 2);
          const matchKey = Object.keys(byPlayer).find(k => {
            const kLower = k.toLowerCase();
            return nameParts.some(part => kLower.includes(part));
          });
          if (!matchKey) return p;
          const match = byPlayer[matchKey];
          const newCat = {
            distancia:  pf(match.Distancia),
            playerLoad: pf(match.PlayerLoad),
            velMax:     pf(match.VelMax),
            mpm:        pf(match.MPM),
            hsr:        pf(match.HSR),
            sprint:     pf(match.Sprint),
            sprintsN:   pf(match.NSprintsH),
            acelsM:     pf(match.AcelsM),
            acelsH:     pf(match.AcelsH),
            decelsM:    pf(match.DecelsM),
            decelsH:    pf(match.DecelsH),
            actividad:  String(match.Actividad || ''),
            fecha:      String(match.Fecha || ''),
          };
          const cargaDia = newCat.playerLoad > 0 ? newCat.playerLoad : newCat.distancia / 100;
          const newLoads = [...p.loads, Math.round(cargaDia)].slice(-28);
          return { ...p, cat: newCat, loads: newLoads };
        }));
        setGpsConnected(true);
        if (!silent) showFlash(`✓ GPS actualizado · ${Object.keys(byPlayer).length} jugadores`, C.green);
      }
    } catch(e) {
      if (!silent) showFlash("⚠ Error leyendo GPS del Sheet", C.red);
    }
  }, []);

  // Auto-fetch GPS al cargar + polling cada 5 minutos
  useEffect(() => {
    fetchGPS(true);
    const interval = setInterval(() => fetchGPS(true), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchGPS]);

  // Auto-fetch wellness al cargar + polling cada 2 minutos
  useEffect(() => {
    fetchWellness(true);
    const interval = setInterval(() => fetchWellness(true), 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchWellness]);

  // ── Connect Google Sheets ──
  const connectGoogle = () => { fetchWellness(false); };

  // ── Computed values ──
  const playersWithACWR = players.map(p => ({
    ...p,
    acwr: calcACWR(p.loads),
    status: (() => {
      const a = calcACWR(p.loads);
      const w = wellnessData.find(w => w.jugador === p.nombre);
      if (a < 0.8 || a > 1.5 || (w && (w.fatiga >= 7 || w.dolor >= 6))) return "risk";
      if (a < 0.94 || a > 1.35 || (w && (w.fatiga >= 5 || w.dolor >= 4))) return "caution";
      return "optimal";
    })(),
    wellness: wellnessData.find(w => w.jugador === p.nombre) || null,
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
    { id:"semaforo",  icon:"◉", label:"Semáforo DT"     },
    { id:"plantilla", icon:"◈", label:"Plantilla"       },
    { id:"carga",     icon:"▸", label:"Control Carga"   },
    { id:"informes",  icon:"⊞", label:"Informes PDF"    },
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
            Semana 1 · BCA 2026-1 ·
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={S.sec}>GPS Catapult</div>
              <div style={{display:"flex",gap:4}}>
                {[['ultima','Última'],['semana','Semana'],['mes','Mes'],['temporada','Temporada']].map(([key,lbl])=>(
                  <button key={key} onClick={()=>setGpsPeriod(key)} style={{
                    fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:6, border:"none", cursor:"pointer",
                    background: gpsPeriod===key ? C.accent : C.card2,
                    color: gpsPeriod===key ? "#000" : C.muted,
                  }}>{lbl}</button>
                ))}
              </div>
            </div>
            {(()=>{
              const d = gpsPeriod==='ultima' ? p.cat : gpsPeriod==='semana' ? p.catSemana : gpsPeriod==='mes' ? p.catMes : p.catTemporada;
              const isTemp = gpsPeriod==='temporada';
              const isSes  = gpsPeriod==='ultima';
              if(!d) return <div style={{textAlign:"center",padding:"20px 0",fontSize:12,color:C.muted}}>Sin datos para este período</div>;
              return (<>
                {d.actividad && <div style={{fontSize:10,color:C.muted,marginBottom:10}}>📅 {d.fecha} · {d.actividad}</div>}
                {d.sesiones  && <div style={{fontSize:10,color:C.accent,marginBottom:10}}>📊 {d.sesiones} sesiones acumuladas</div>}
                {[
                  { label:"Distancia total",   val:`${Math.round(d.distancia||0).toLocaleString()} m`,  pct:Math.min(100,Math.round((d.distancia||0)/(isTemp?1800:isSes?120:500))), color:C.green  },
                  { label:"Player Load",        val:`${Math.round(d.playerLoad||0).toLocaleString()} UA`,pct:Math.min(100,Math.round((d.playerLoad||0)/(isTemp?180:isSes?12:50))),  color:C.red    },
                  { label:isSes?"Vel. máx":"Vel. máx (pico)", val:`${(d.velMax||0).toFixed(1)} km/h`,   pct:Math.min(100,Math.round((d.velMax||0)*3)),                              color:C.blue   },
                  { label:"m/min (prom)",       val:`${Math.round(d.mpm||0)} m/min`,                    pct:Math.min(100,Math.round((d.mpm||0)/1.2)),                               color:C.purple },
                  { label:"HSR (+19.8 km/h)",   val:`${Math.round(d.hsr||0).toLocaleString()} m`,       pct:Math.min(100,Math.round((d.hsr||0)/(isTemp?20:isSes?6:8))),            color:C.blue   },
                  { label:"Sprints (+25 km/h)", val:`${(d.sprintsN||0)} esfuerzos`,                     pct:Math.min(100,Math.round((d.sprintsN||0)/(isTemp?1.2:isSes?0.5:0.8))), color:C.purple },
                  { label:"Acel (med+alto)",    val:`${(d.acelsM||0)} + ${(d.acelsH||0)}`,              pct:Math.min(100,Math.round(((d.acelsM||0)+(d.acelsH||0))/(isTemp?7:isSes?0.6:2))), color:C.yellow },
                  { label:"Decel (med+alto)",   val:`${(d.decelsM||0)} + ${(d.decelsH||0)}`,            pct:Math.min(100,Math.round(((d.decelsM||0)+(d.decelsH||0))/(isTemp?7:isSes?0.6:2))), color:C.orange },
                ].map((m,i)=>(
                  <div key={i} style={{marginBottom:12}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:11,color:C.muted}}>{m.label}</span>
                      <span style={{fontSize:12,fontWeight:700,color:C.text,fontFamily:"monospace"}}>{m.val}</span>
                    </div>
                    <div style={S.bar(m.pct,m.color)}/>
                  </div>
                ))}
              </>);
            })()}
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
                Conecta con el Sheet de Wellness para ver los datos en tiempo real:
              </div>
              <button onClick={connectGoogle} disabled={wellnessLoading}
                style={{width:"100%",padding:"9px",borderRadius:9,background:wellnessLoading?`${C.purple}50`:C.purple,
                  color:"#06080f",fontSize:11,fontWeight:800,border:"none",cursor:"pointer"}}>
                {wellnessLoading?"⏳ Cargando...":"⚡ Cargar Wellness desde Sheet"}
              </button>
            </>
          ) : (
            <div>
              <div style={{padding:"10px 12px",borderRadius:8,background:`${C.green}10`,
                border:`1px solid ${C.green}25`,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:11,fontWeight:700,color:C.green}}>✓ Sincronizado</div>
                  <div style={{fontSize:10,color:C.muted}}>{wellnessData.filter(w=>w.fecha).length} jugadores con datos reales</div>
                </div>
                <button onClick={connectGoogle} disabled={wellnessLoading}
                  style={{padding:"5px 10px",borderRadius:7,background:`${C.purple}20`,
                    color:C.purple,fontSize:10,fontWeight:700,border:"none",cursor:"pointer"}}>
                  {wellnessLoading?"...":"↻ Actualizar"}
                </button>
              </div>
              {wellnessData.slice(0,4).map((w,i)=>(
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
            {label:"Google Forms", ok:gConnected, n:wellnessData.length, color:C.purple},
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

  // ── SEMÁFORO DT ──
  const PageSemaforo = () => {
    const riesgo = playersWithACWR.filter(p => p.status === "risk");
    const precaucion = playersWithACWR.filter(p => p.status === "caution");
    const optimos = playersWithACWR.filter(p => p.status === "optimal");
    const acwrRiesgo = playersWithACWR.filter(p => p.acwr < 0.8 || p.acwr > 1.5);

    const TrafficLight = ({ status, count }) => {
      const cfg = { optimal: { color: C.green, label: "DISPONIBLE", icon: "✓" },
                    caution:  { color: C.yellow, label: "PRECAUCIÓN", icon: "⚠" },
                    risk:     { color: C.red,    label: "NO DISPONIBLE", icon: "✕" } };
      const c = cfg[status];
      return (
        <div style={{ textAlign:"center" }}>
          <div style={{ width:70, height:70, borderRadius:"50%", background:`${c.color}20`,
            border:`3px solid ${c.color}`, display:"flex", alignItems:"center",
            justifyContent:"center", margin:"0 auto 8px", fontSize:28, fontWeight:900, color:c.color }}>
            {count}
          </div>
          <div style={{ fontSize:9, fontWeight:800, letterSpacing:"0.1em", color:c.color }}>{c.label}</div>
        </div>
      );
    };

    return (
      <div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
          <div>
            <div style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.025em" }}>Semáforo de Disponibilidad</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>Reporte para el cuerpo técnico · Hoy</div>
          </div>
        </div>

        {/* ACWR Alert Banner */}
        {acwrRiesgo.length > 0 && (
          <div style={{ background:`${C.red}10`, border:`1px solid ${C.red}30`, borderRadius:12,
            padding:"14px 18px", marginBottom:18, display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ fontSize:20 }}>🚨</div>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:C.red }}>
                ALERTA ACWR — {acwrRiesgo.length} jugador{acwrRiesgo.length>1?"es":""} en zona de riesgo
              </div>
              <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>
                {acwrRiesgo.map(p=>`${p.nombre} (${p.acwr})`).join(", ")} · ACWR fuera de rango seguro (0.8–1.5)
              </div>
            </div>
          </div>
        )}

        {/* Traffic lights summary */}
        <div style={{ ...S.card({ marginBottom:18 }) }}>
          <div style={{ display:"flex", justifyContent:"space-around", alignItems:"center", padding:"12px 0" }}>
            <TrafficLight status="optimal" count={optimos.length}/>
            <div style={{ width:1, height:60, background:C.border }}/>
            <TrafficLight status="caution" count={precaucion.length}/>
            <div style={{ width:1, height:60, background:C.border }}/>
            <TrafficLight status="risk" count={riesgo.length}/>
          </div>
          <div style={{ textAlign:"center", padding:"10px 0 4px", fontSize:11, color:C.muted }}>
            Total plantilla: <strong style={{color:C.text}}>{players.length} jugadores</strong> ·
            Disponibilidad: <strong style={{color:C.green}}>{Math.round((optimos.length/players.length)*100)}%</strong>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {/* Disponibles */}
          <div style={S.card()}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
              <div style={{ width:10, height:10, borderRadius:"50%", background:C.green }}/>
              <div style={{ fontSize:11, fontWeight:700, color:C.green, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                Disponibles ({optimos.length})
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {optimos.map(p => (
                <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                  borderRadius:8, background:`${C.green}08`, border:`1px solid ${C.green}18` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600 }}>{p.nombre}</div>
                    <div style={{ fontSize:10, color:C.muted }}>{p.pos}</div>
                  </div>
                  <div style={{ fontSize:11, fontFamily:"monospace", color:C.green, fontWeight:700 }}>
                    ACWR {p.acwr}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Precaución + Riesgo */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {precaucion.length > 0 && (
              <div style={S.card()}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:C.yellow }}/>
                  <div style={{ fontSize:11, fontWeight:700, color:C.yellow, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    Precaución ({precaucion.length})
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {precaucion.map(p => {
                    const w = p.wellness;
                    return (
                      <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                        borderRadius:8, background:`${C.yellow}08`, border:`1px solid ${C.yellow}25` }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, fontWeight:600 }}>{p.nombre}</div>
                          <div style={{ fontSize:10, color:C.muted }}>
                            {p.pos} · ACWR {p.acwr}
                            {w?.fatiga >= 5 ? ` · Fatiga ${w.fatiga}/10` : ""}
                            {w?.dolor >= 4 ? ` · Dolor ${w.dolor}/10` : ""}
                          </div>
                        </div>
                        <Tag label="⚠ Monitoreo" color={C.yellow}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {riesgo.length > 0 && (
              <div style={S.card()}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                  <div style={{ width:10, height:10, borderRadius:"50%", background:C.red }}/>
                  <div style={{ fontSize:11, fontWeight:700, color:C.red, textTransform:"uppercase", letterSpacing:"0.08em" }}>
                    No disponibles ({riesgo.length})
                  </div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {riesgo.map(p => {
                    const w = p.wellness;
                    return (
                      <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px",
                        borderRadius:8, background:`${C.red}08`, border:`1px solid ${C.red}25` }}>
                        <div style={{ flex:1 }}>
                          <div style={{ fontSize:12, fontWeight:600 }}>{p.nombre}</div>
                          <div style={{ fontSize:10, color:C.muted }}>
                            {p.pos} · ACWR {p.acwr}
                            {w?.fatiga >= 7 ? ` · Fatiga crítica ${w.fatiga}/10` : ""}
                            {w?.dolor >= 6 ? ` · Dolor alto ${w.dolor}/10` : ""}
                          </div>
                        </div>
                        <Tag label="✕ Riesgo" color={C.red}/>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {riesgo.length === 0 && precaucion.length === 0 && (
              <div style={{ ...S.card(), textAlign:"center", padding:"32px" }}>
                <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
                <div style={{ fontSize:14, fontWeight:700, color:C.green }}>Plantilla en óptimas condiciones</div>
                <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>Sin jugadores en riesgo hoy</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── INFORMES PDF ──
  const PageInformes = () => {
    const [modo, setModo] = useState("partido"); // "jugador" | "partido"
    const [jugSelec, setJugSelec] = useState(playersWithACWR[0]?.id || null);
    const [diasSelec, setDiasSelec] = useState([]);
    const [sesionSelec, setSesionSelec] = useState(null);
    const [generando, setGenerando] = useState(false);
    const [preview, setPreview] = useState(false);
    const [gpsData, setGpsData] = useState([]);
    const [loadingGps, setLoadingGps] = useState(false);

    // Fetch all GPS rows from sheet
    useEffect(() => {
      setLoadingGps(true);
      fetch(`${GPS_SCRIPT_URL}?tipo=gps`)
        .then(r => r.json())
        .then(rows => { setGpsData(rows); setLoadingGps(false); })
        .catch(() => setLoadingGps(false));
    }, []);

    const jugadorActual = playersWithACWR.find(p => p.id === jugSelec);

    // Sesiones unicas de partidos (Fecha X)
    const partidos = [...new Map(
      gpsData.filter(r => r.Actividad && r.Actividad.toLowerCase().includes('fecha'))
        .map(r => [r.Actividad, {actividad: r.Actividad, fecha: r.Fecha}])
    ).values()].sort((a,b) => a.fecha.localeCompare(b.fecha));

    // Dias disponibles para jugador seleccionado
    const diasJugador = jugadorActual ? [...new Set(
      gpsData.filter(r => (r.Jugador||'').toLowerCase().includes(jugadorActual.nombre.split(' ')[0].toLowerCase()))
        .map(r => r.Fecha)
    )].sort() : [];

    const toggleDia = (fecha) => {
      setDiasSelec(prev => prev.includes(fecha) ? prev.filter(d=>d!==fecha) : [...prev, fecha]);
      setPreview(false);
    };

    const pf = v => { const n = parseFloat(String(v||0)); return isNaN(n) ? 0 : n; };

    // Pos colors
    const posColor = { POR:'#f59e0b', LAT:'#3b82f6', DC:'#ef4444', MCD:'#8b5cf6',
      MCI:'#06b6d4', MCO:'#10b981', EXT:'#f97316', DEL:'#ec4899',
      'GOAL KEEPER':'#f59e0b', LATERAL:'#3b82f6', 'MEDIO CENTRO':'#8b5cf6',
      INTERIOR:'#06b6d4', EXTREMO:'#f97316', DELANTERO:'#ec4899',
      'DEFENSA CENTRAL':'#ef4444', 'DEFENSA CEN':'#ef4444' };
    const getPC = pos => posColor[(pos||'').toUpperCase()] || posColor[pos] || '#64748b';

    // Heat color for values
    const heatColor = (val, max, invert=false) => {
      const pct = max > 0 ? Math.min(1, val/max) : 0;
      const v = invert ? 1-pct : pct;
      if (v >= 0.8) return {bg:'#dcfce7',color:'#166534'};
      if (v >= 0.6) return {bg:'#d1fae5',color:'#065f46'};
      if (v >= 0.4) return {bg:'#fef9c3',color:'#713f12'};
      if (v >= 0.2) return {bg:'#ffedd5',color:'#9a3412'};
      return {bg:'#fee2e2',color:'#991b1b'};
    };

    const imprimirPDF = () => {
      const el = document.getElementById('informe-render');
      if (!el) return;
      const w = window.open('','_blank');
      w.document.write(`<!DOCTYPE html><html><head><title>PerfLoad Informe</title>
        <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          *{box-sizing:border-box;margin:0;padding:0;}
          body{font-family:'Barlow',sans-serif;background:#fff;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
          @page{size:A4 landscape;margin:10mm;}
          @media print{.no-print{display:none!important;}}
        </style></head><body>${el.innerHTML}</body></html>`);
      w.document.close();
      setTimeout(()=>w.print(),600);
    };

    // ── INFORME PARTIDO ──
    const InformePartido = () => {
      if (!sesionSelec) return null;
      const filas = gpsData.filter(r => r.Actividad === sesionSelec);
      if (!filas.length) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Sin datos para esta sesión</div>;

      // Sort by distance desc, exclude GK for team averages
      const sorted = [...filas].sort((a,b) => pf(b.Distancia)-pf(a.Distancia));
      const campo = filas.filter(r => !(r.Posicion||'').toLowerCase().includes('goal') && !(r.Posicion||'').toLowerCase().includes('por'));
      const n = 10; // divide by 10 field players

      const avg = key => campo.length ? Math.round(campo.reduce((s,r)=>s+pf(r[key]),0)/n) : 0;
      const avgF = (key,dec=1) => campo.length ? (campo.reduce((s,r)=>s+pf(r[key]),0)/n).toFixed(dec) : '0';

      // Maxes for heatmap
      const maxes = {};
      ['Distancia','PlayerLoad','VelMax','HSR','Sprint','NSprintsH','AcelsH','DecelsH','HMLD','Duracion'].forEach(k => {
        maxes[k] = Math.max(...filas.map(r => pf(r[k])));
      });

      // Group by position
      const byPos = {};
      filas.forEach(r => {
        const pos = (r.Posicion||'Otro').toUpperCase();
        if (!byPos[pos]) byPos[pos] = [];
        byPos[pos].push(r);
      });

      const fecha = filas[0]?.Fecha || '';

      return (
        <div id="informe-render" style={{background:'#fff',fontFamily:"'Barlow',sans-serif",fontSize:11}}>

          {/* ── PÁGINA 1: HEADER + PROMEDIOS + TABLA ── */}
          <div style={{pageBreakAfter:'always'}}>
            {/* Header */}
            <div style={{background:'#06080f',color:'#fff',padding:'16px 24px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',letterSpacing:'0.15em',textTransform:'uppercase'}}>⬡ PERFLOAD · ORSOMARSO SC · BCA 2026-1</div>
                <div style={{fontSize:22,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif",marginTop:2}}>{sesionSelec.toUpperCase()}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>{fecha} · {filas.length} jugadores</div>
              </div>
              <div style={{display:'flex',gap:24}}>
                {[
                  {l:'DISTANCIA PROM',v:`${avg('Distancia').toLocaleString()} m`,c:'#00e676'},
                  {l:'PLAYER LOAD PROM',v:`${avg('PlayerLoad')} UA`,c:'#ffab40'},
                  {l:'VEL MÁX PROM',v:`${avgF('VelMax')} km/h`,c:'#40c4ff'},
                  {l:'HSR PROM',v:`${avg('HSR')} m`,c:'#ce93d8'},
                  {l:'SPRINT PROM',v:`${avg('Sprint')} m`,c:'#ef4444'},
                ].map((k,i) => (
                  <div key={i} style={{textAlign:'center'}}>
                    <div style={{fontSize:18,fontWeight:900,color:k.c,fontFamily:"'Barlow Condensed',sans-serif",lineHeight:1}}>{k.v}</div>
                    <div style={{fontSize:8,color:'rgba(255,255,255,0.35)',marginTop:2,textTransform:'uppercase',letterSpacing:'0.06em'}}>{k.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Promedios generales */}
            <div style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0',padding:'12px 24px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>PROMEDIOS GENERALES DEL EQUIPO <span style={{color:'#94a3b8',fontWeight:400}}>(base 10 jugadores de campo)</span></div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(9,1fr)',gap:8}}>
                {[
                  {l:'Tiempo (min)',v:avgF('Duracion',0)},{l:'Distancia (m)',v:avg('Distancia').toLocaleString()},
                  {l:'m/min',v:avgF('MPM',0)},{l:'HSR >19.8 (m)',v:avg('HSR').toLocaleString()},
                  {l:'Sprint >25 (m)',v:avg('Sprint').toLocaleString()},{l:'# Sprints',v:avgF('NSprintsH',0)},
                  {l:'Acels >3',v:avgF('AcelsH',0)},{l:'Decels >3',v:avgF('DecelsH',0)},
                  {l:'HMLD (m)',v:avg('HMLD').toLocaleString()},
                ].map((k,i) => (
                  <div key={i} style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:'8px 10px',textAlign:'center'}}>
                    <div style={{fontSize:16,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif",color:'#111'}}>{k.v}</div>
                    <div style={{fontSize:8,color:'#475569',textTransform:'uppercase',letterSpacing:'0.05em',marginTop:2}}>{k.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabla individual con heatmap */}
            <div style={{padding:'12px 24px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>CUADRO RESUMEN INDIVIDUAL</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:10}}>
                <thead>
                  <tr style={{background:'#06080f',color:'#fff'}}>
                    {['Jugador','Pos','Min','Dist (m)','m/min','HSR (m)','Sprint (m)','# Sprint','% Vmax','Vmax','Acels >3','Decels >3','HMLD','Estado'].map(h=>(
                      <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:8,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r,i) => {
                    const p = playersWithACWR.find(pl => pl.nombre.toLowerCase().includes((r.Jugador||'').toLowerCase().split(' ')[0].toLowerCase()));
                    const sc = p ? statusCfg[p.status] : {label:'—',color:'#94a3b8'};
                    const pc = getPC(r.Posicion);
                    return (
                      <tr key={i} style={{background:i%2===0?'#f8fafc':'#fff',borderBottom:'1px solid #e2e8f0'}}>
                        <td style={{padding:'5px 8px',fontWeight:700,whiteSpace:'nowrap'}}>
                          <div style={{display:'flex',alignItems:'center',gap:5}}>
                            <div style={{width:3,height:16,background:pc,borderRadius:2,flexShrink:0}}/>
                            {r.Jugador}
                          </div>
                        </td>
                        <td style={{padding:'5px 8px'}}>
                          <span style={{padding:'1px 5px',borderRadius:3,fontSize:8,fontWeight:700,background:`${pc}20`,color:pc}}>{r.Posicion}</span>
                        </td>
                        {[
                          {k:'Duracion',dec:0},{k:'Distancia',dec:0},{k:'MPM',dec:0},
                          {k:'HSR',dec:0},{k:'Sprint',dec:0},{k:'NSprintsH',dec:0},
                          {k:'PctVelMax',dec:1},{k:'VelMax',dec:1},{k:'AcelsH',dec:0},{k:'DecelsH',dec:0},{k:'HMLD',dec:0}
                        ].map(({k,dec},j) => {
                          const val = pf(r[k]);
                          const hc = heatColor(val, maxes[k]||1, k==='Duracion');
                          return (
                            <td key={j} style={{padding:'5px 8px',fontFamily:'monospace',fontWeight:600,background:hc.bg,color:hc.color,textAlign:'right'}}>
                              {dec===0?Math.round(val).toLocaleString():val.toFixed(dec)}
                            </td>
                          );
                        })}
                        <td style={{padding:'5px 8px'}}>
                          <span style={{padding:'2px 6px',borderRadius:3,fontSize:8,fontWeight:700,background:`${sc.color}18`,color:sc.color,whiteSpace:'nowrap'}}>{sc.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── PÁGINA 2: GRÁFICOS DE BARRAS POR POSICIÓN ── */}
          <div style={{pageBreakAfter:'always',padding:'16px 24px'}}>
            <div style={{background:'#06080f',color:'#fff',padding:'10px 16px',borderRadius:8,marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:16,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif"}}>{sesionSelec.toUpperCase()} · ANÁLISIS POR POSICIÓN</div>
              <div style={{fontSize:9,color:'rgba(255,255,255,0.4)'}}>{fecha}</div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              {[
                {key:'Distancia',label:'DISTANCIA TOTAL (m)',color:'#00e676'},
                {key:'HSR',label:'DISTANCIA HSR >19.8 km/h (m)',color:'#ce93d8'},
                {key:'Sprint',label:'DISTANCIA SPRINT >25 km/h (m)',color:'#ef4444'},
                {key:'HMLD',label:'HMLD (m)',color:'#ffab40'},
                {key:'VelMax',label:'VELOCIDAD MÁXIMA (km/h)',color:'#40c4ff'},
                {key:'AcelsH',label:'ACELERACIONES >3 m/s²',color:'#fbbf24'},
                {key:'DecelsH',label:'DESACELERACIONES <-3 m/s²',color:'#60a5fa'},
                {key:'NSprintsH',label:'# SPRINTS >25 km/h',color:'#f97316'},
              ].map(({key,label,color}) => {
                const chartData = [...sorted].sort((a,b)=>pf(b[key])-pf(a[key]));
                const maxV = Math.max(...chartData.map(r=>pf(r[key]))) || 1;
                return (
                  <div key={key} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px'}}>
                    <div style={{fontSize:9,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8,borderLeft:`3px solid ${color}`,paddingLeft:6}}>{label}</div>
                    {chartData.map((r,i) => {
                      const val = pf(r[key]);
                      const pct = (val/maxV)*100;
                      const pc = getPC(r.Posicion);
                      return (
                        <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                          <div style={{width:3,height:12,background:pc,borderRadius:1,flexShrink:0}}/>
                          <div style={{width:90,fontSize:8,color:'#1e293b',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flexShrink:0}}>{(r.Jugador||'').split(' ')[0]} {(r.Jugador||'').split(' ')[1]?.[0]}.</div>
                          <div style={{flex:1,height:10,background:'#e5e7eb',borderRadius:2,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${pct}%`,background:color,borderRadius:2}}/>
                          </div>
                          <div style={{width:45,fontSize:8,fontWeight:700,color:'#111827',fontFamily:'monospace',textAlign:'right',flexShrink:0}}>{key==='VelMax'?val.toFixed(1):Math.round(val).toLocaleString()}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── PÁGINA 3: CONSOLIDADO POR PARTIDO ── */}
          <div style={{pageBreakAfter:'always',padding:'16px 24px'}}>
            <div style={{background:'#06080f',color:'#fff',padding:'10px 16px',borderRadius:8,marginBottom:16}}>
              <div style={{fontSize:16,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif"}}>CONSOLIDADO DE PROMEDIOS POR PARTIDO · TEMPORADA 2026-1</div>
            </div>
            {(() => {
              const todosPartidos = partidos;
              if (!todosPartidos.length) return null;
              return (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                  {[
                    {key:'Distancia',label:'DISTANCIA TOTAL PROMEDIO (m)',color:'#00e676'},
                    {key:'HSR',label:'HSR PROMEDIO >19.8 km/h (m)',color:'#ce93d8'},
                    {key:'Sprint',label:'SPRINT PROMEDIO >25 km/h (m)',color:'#ef4444'},
                    {key:'HMLD',label:'HMLD PROMEDIO (m)',color:'#ffab40'},
                  ].map(({key,label,color}) => {
                    const partData = todosPartidos.map(p => {
                      const filasPart = gpsData.filter(r => r.Actividad === p.actividad);
                      const campoRows = filasPart.filter(r => !(r.Posicion||'').toLowerCase().includes('goal'));
                      const avg = campoRows.length ? Math.round(campoRows.reduce((s,r)=>s+pf(r[key]),0)/10) : 0;
                      const label = p.actividad.replace('Fecha ','F').replace(' 26-1','').replace(' VS ',' vs ').replace(' vs ',' vs\n');
                      return {label, avg, full: p.actividad};
                    });
                    const maxV = Math.max(...partData.map(d=>d.avg)) || 1;
                    const isCurrent = (full) => full === sesionSelec;
                    return (
                      <div key={key} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px'}}>
                        <div style={{fontSize:9,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:10,borderLeft:`3px solid ${color}`,paddingLeft:6}}>{label}</div>
                        {partData.map((d,i) => (
                          <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
                            <div style={{width:70,fontSize:7.5,color:'#1e293b',fontWeight:isCurrent(d.full)?700:500,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.label.replace('\n',' ')}</div>
                            <div style={{flex:1,height:12,background:'#e5e7eb',borderRadius:2,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${(d.avg/maxV)*100}%`,background:isCurrent(d.full)?color:`${color}60`,borderRadius:2}}/>
                            </div>
                            <div style={{width:50,fontSize:8,fontWeight:700,color:'#111',fontFamily:'monospace',textAlign:'right'}}>{d.avg.toLocaleString()}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Footer */}
          <div style={{padding:'8px 24px',borderTop:'1px solid #e2e8f0',display:'flex',justifyContent:'space-between'}}>
            <div style={{fontSize:8,color:'#475569'}}>⬡ PERFLOAD · Orsomarso SC · BCA 2026-1</div>
            <div style={{fontSize:8,color:'#475569'}}>{new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}</div>
          </div>
        </div>
      );
    };

    // ── INFORME JUGADOR ──
    const InformeJugador = () => {
      if (!jugadorActual) return null;
      const nombre = jugadorActual.nombre;
      const filasJug = gpsData.filter(r => (r.Jugador||'').toLowerCase().includes(nombre.toLowerCase().split(' ')[0].toLowerCase()));
      const filasSelec = diasSelec.length > 0 ? filasJug.filter(r => diasSelec.includes(r.Fecha)) : filasJug.slice(-1);
      if (!filasSelec.length) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Sin datos para los días seleccionados</div>;

      const sc = statusCfg[jugadorActual.status];
      const w = jugadorActual.wellness;

      // All matches for this player - deduplicate by Actividad, keep max duration
      const _partMap = {};
      filasJug.filter(r => r.Actividad && r.Actividad.toLowerCase().includes('fecha')).forEach(r => {
        const key = r.Actividad;
        if (!_partMap[key] || parseFloat(r.Duracion||0) > parseFloat(_partMap[key].Duracion||0)) {
          _partMap[key] = r;
        }
      });
      const partJug = Object.values(_partMap).sort((a,b) => a.Fecha.localeCompare(b.Fecha));

      return (
        <div id="informe-render" style={{background:'#fff',fontFamily:"'Barlow',sans-serif",fontSize:11}}>

          {/* ── PÁGINA 1: RESUMEN POR DÍA ── */}
          <div style={{pageBreakAfter:'always'}}>
            <div style={{background:'#06080f',color:'#fff',padding:'16px 24px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:9,color:'rgba(255,255,255,0.4)',letterSpacing:'0.15em',textTransform:'uppercase'}}>⬡ PERFLOAD · INFORME INDIVIDUAL · ORSOMARSO SC</div>
                <div style={{fontSize:26,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:'-0.01em'}}>{nombre.toUpperCase()}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.4)',marginTop:2}}>{jugadorActual.pos} · {jugadorActual.edad} años · {jugadorActual.peso}kg · {jugadorActual.talla}cm</div>
              </div>
              <div style={{display:'flex',gap:16,alignItems:'center'}}>
                <span style={{padding:'4px 12px',borderRadius:4,fontSize:11,fontWeight:700,background:`${sc.color}25`,color:sc.color,border:`1px solid ${sc.color}40`}}>{sc.label.toUpperCase()}</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:36,fontWeight:900,color:acwrColor(jugadorActual.acwr),fontFamily:"'Barlow Condensed',sans-serif",lineHeight:1}}>{jugadorActual.acwr}</div>
                  <div style={{fontSize:8,color:'rgba(255,255,255,0.3)',textTransform:'uppercase'}}>ACWR</div>
                </div>
              </div>
            </div>

            <div style={{padding:'12px 24px'}}>
              {/* Sessions selected */}
              {filasSelec.map((r,idx) => {
                const maxRef = {Distancia:12000,PlayerLoad:1200,VelMax:36,MPM:120,HSR:800,Sprint:300,NSprintsH:20,AcelsH:20,DecelsH:20,HMLD:1500};
                return (
                  <div key={idx} style={{marginBottom:16,background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
                    <div style={{background:'#1e293b',color:'#fff',padding:'8px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div style={{fontSize:12,fontWeight:700,fontFamily:"'Barlow Condensed',sans-serif"}}>{r.Actividad?.toUpperCase()}</div>
                      <div style={{fontSize:10,color:'rgba(255,255,255,0.5)'}}>{r.Fecha} · {pf(r.Duracion).toFixed(0)} min</div>
                    </div>
                    <div style={{padding:'10px 14px'}}>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6,marginBottom:10}}>
                        {[
                          {l:'Distancia',v:`${Math.round(pf(r.Distancia)).toLocaleString()} m`,c:'#00e676'},
                          {l:'Player Load',v:`${Math.round(pf(r.PlayerLoad))} UA`,c:'#ffab40'},
                          {l:'Vel. Máx',v:`${pf(r.VelMax).toFixed(1)} km/h`,c:'#40c4ff'},
                          {l:'HSR',v:`${Math.round(pf(r.HSR))} m`,c:'#ce93d8'},
                          {l:'HMLD',v:`${Math.round(pf(r.HMLD))} m`,c:'#f97316'},
                        ].map((k,i) => (
                          <div key={i} style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:6,padding:'8px',textAlign:'center'}}>
                            <div style={{fontSize:16,fontWeight:900,color:k.c,fontFamily:"'Barlow Condensed',sans-serif",lineHeight:1}}>{k.v}</div>
                            <div style={{fontSize:8,color:'#475569',textTransform:'uppercase',marginTop:2}}>{k.l}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                        <div>
                          {[
                            {k:'Distancia',l:'Distancia total',c:'#00e676',max:maxRef.Distancia,u:'m'},
                            {k:'PlayerLoad',l:'Player Load',c:'#ffab40',max:maxRef.PlayerLoad,u:'UA'},
                            {k:'HSR',l:'HSR >19.8 km/h',c:'#ce93d8',max:maxRef.HSR,u:'m'},
                            {k:'Sprint',l:'Sprint >25 km/h',c:'#ef4444',max:maxRef.Sprint,u:'m'},
                            {k:'HMLD',l:'HMLD',c:'#f97316',max:maxRef.HMLD,u:'m'},
                          ].map(({k,l,c,max,u},i) => {
                            const val = pf(r[k]);
                            const pct = Math.min(100,(val/max)*100);
                            return (
                              <div key={i} style={{marginBottom:6}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                                  <span style={{fontSize:9,color:'#374151',fontWeight:500}}>{l}</span>
                                  <span style={{fontSize:9,fontWeight:800,fontFamily:'monospace',color:'#111827'}}>{Math.round(val).toLocaleString()} {u}</span>
                                </div>
                                <div style={{height:5,background:'#e5e7eb',borderRadius:2}}>
                                  <div style={{height:'100%',width:`${pct}%`,background:c,borderRadius:2}}/>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div>
                          {[
                            {k:'MPM',l:'m/min',c:'#06b6d4',max:maxRef.MPM,u:''},
                            {k:'VelMax',l:'Vel. Máxima',c:'#40c4ff',max:maxRef.VelMax,u:'km/h'},
                            {k:'NSprintsH',l:'# Sprints',c:'#ef4444',max:maxRef.NSprintsH,u:''},
                            {k:'AcelsH',l:'Acels >3 m/s²',c:'#fbbf24',max:maxRef.AcelsH,u:''},
                            {k:'DecelsH',l:'Decels <-3 m/s²',c:'#60a5fa',max:maxRef.DecelsH,u:''},
                          ].map(({k,l,c,max,u},i) => {
                            const val = pf(r[k]);
                            const pct = Math.min(100,(val/max)*100);
                            return (
                              <div key={i} style={{marginBottom:6}}>
                                <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                                  <span style={{fontSize:9,color:'#374151',fontWeight:500}}>{l}</span>
                                  <span style={{fontSize:9,fontWeight:800,fontFamily:'monospace',color:'#111827'}}>{k==='VelMax'?val.toFixed(1):Math.round(val)} {u}</span>
                                </div>
                                <div style={{height:5,background:'#e5e7eb',borderRadius:2}}>
                                  <div style={{height:'100%',width:`${pct}%`,background:c,borderRadius:2}}/>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Wellness del día */}
              {w && (
                <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 14px'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:8}}>WELLNESS DEL DÍA</div>
                  <div style={{display:'flex',gap:12,alignItems:'center'}}>
                    {[{l:'Sueño',v:w.sueno,inv:false},{l:'Fatiga',v:w.fatiga,inv:true},{l:'Dolor',v:w.dolor,inv:true},{l:'Humor',v:w.humor,inv:false},{l:'Estrés',v:w.estres,inv:true}].map((d,i) => {
                      const score = d.inv ? 10-d.v : d.v;
                      const c = score>=7?'#10b981':score>=5?'#f59e0b':'#ef4444';
                      return (
                        <div key={i} style={{textAlign:'center'}}>
                          <div style={{width:32,height:32,borderRadius:'50%',background:`${c}15`,border:`2px solid ${c}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,color:c,margin:'0 auto 3px'}}>{d.v}</div>
                          <div style={{fontSize:7,color:'#94a3b8',textTransform:'uppercase'}}>{d.l}</div>
                        </div>
                      );
                    })}
                    <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:'#fff',border:'1px solid #e2e8f0',borderRadius:6}}>
                      <span style={{fontSize:9,color:'#374151',fontWeight:500}}>RPE</span>
                      <span style={{fontSize:20,fontWeight:900,color:'#f97316',fontFamily:"'Barlow Condensed',sans-serif"}}>{w.rpe}/10</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── PÁGINA 2: CONSOLIDADO DE COMPETENCIA ── */}
          {partJug.length > 0 && (
            <div style={{padding:'16px 24px'}}>
              <div style={{background:'#06080f',color:'#fff',padding:'10px 16px',borderRadius:8,marginBottom:16}}>
                <div style={{fontSize:16,fontWeight:900,fontFamily:"'Barlow Condensed',sans-serif"}}>{nombre.toUpperCase()} · CONSOLIDADO EN COMPETENCIA · TEMPORADA 2026-1</div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
                {[
                  {key:'Distancia',label:'DISTANCIA TOTAL (m)',color:'#00e676'},
                  {key:'HSR',label:'HSR >19.8 km/h (m)',color:'#ce93d8'},
                  {key:'Sprint',label:'SPRINT >25 km/h (m)',color:'#ef4444'},
                  {key:'HMLD',label:'HMLD (m)',color:'#ffab40'},
                  {key:'VelMax',label:'VELOCIDAD MÁXIMA (km/h)',color:'#40c4ff'},
                  {key:'NSprintsH',label:'# SPRINTS',color:'#f97316'},
                  {key:'AcelsH',label:'ACELERACIONES >3 m/s²',color:'#fbbf24'},
                  {key:'DecelsH',label:'DESACELERACIONES <-3 m/s²',color:'#60a5fa'},
                ].map(({key,label,color}) => {
                  const maxV = Math.max(...partJug.map(r=>pf(r[key]))) || 1;
                  return (
                    <div key={key} style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:9,fontWeight:700,color:'#334155',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:8,borderLeft:`3px solid ${color}`,paddingLeft:6}}>{label}</div>
                      {partJug.map((r,i) => {
                        const val = pf(r[key]);
                        const pct = (val/maxV)*100;
                        const isSel = diasSelec.includes(r.Fecha);
                        return (
                          <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                            <div style={{width:80,fontSize:7.5,color:'#1e293b',fontWeight:isSel?700:500,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.Actividad.replace('Fecha ','F').replace(' 26-1','').replace(' VS ',' vs ')}</div>
                            <div style={{flex:1,height:10,background:'#e5e7eb',borderRadius:2,overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${pct}%`,background:isSel?color:`${color}55`,borderRadius:2}}/>
                            </div>
                            <div style={{width:45,fontSize:8,fontWeight:700,color:'#111',fontFamily:'monospace',textAlign:'right'}}>{key==='VelMax'?val.toFixed(1):Math.round(val).toLocaleString()}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div style={{marginTop:12,borderTop:'1px solid #e2e8f0',paddingTop:8,display:'flex',justifyContent:'space-between'}}>
                <div style={{fontSize:8,color:'#475569'}}>⬡ PERFLOAD · Orsomarso SC · BCA 2026-1</div>
                <div style={{fontSize:8,color:'#475569'}}>{new Date().toLocaleDateString('es-CO',{year:'numeric',month:'long',day:'numeric'})}</div>
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div>
        <div style={{fontSize:22,fontWeight:800,letterSpacing:'-0.02em',marginBottom:6,color:'#f0f5ff'}}>Informes PDF</div>
        <div style={{fontSize:12,color:'rgba(255,255,255,0.42)',marginBottom:20}}>Informes profesionales de partido o jugador</div>

        <div style={{display:'grid',gridTemplateColumns:'280px 1fr',gap:16}}>
          {/* Panel config */}
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            <div style={{background:'#0e1220',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,padding:'14px'}}>
              <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.42)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Tipo de informe</div>
              <div style={{display:'flex',gap:6}}>
                {[['partido','📋 Partido'],['jugador','👤 Jugador']].map(([v,l])=>(
                  <button key={v} onClick={()=>{setModo(v);setPreview(false);}} style={{
                    flex:1,padding:'8px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',
                    border:`1px solid ${modo===v?'#00e676':'rgba(255,255,255,0.06)'}`,
                    background:modo===v?'rgba(0,230,118,0.12)':'transparent',
                    color:modo===v?'#00e676':'rgba(255,255,255,0.42)'}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {modo==='partido' && (
              <div style={{background:'#0e1220',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,padding:'14px'}}>
                <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.42)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Seleccionar partido</div>
                {loadingGps ? <div style={{color:'rgba(255,255,255,0.3)',fontSize:11}}>Cargando...</div> :
                <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:280,overflowY:'auto'}}>
                  {partidos.map((p,i)=>(
                    <div key={i} onClick={()=>{setSesionSelec(p.actividad);setPreview(false);}} style={{
                      padding:'7px 10px',borderRadius:8,cursor:'pointer',
                      background:sesionSelec===p.actividad?'rgba(0,230,118,0.08)':'rgba(255,255,255,0.02)',
                      border:`1px solid ${sesionSelec===p.actividad?'rgba(0,230,118,0.3)':'rgba(255,255,255,0.04)'}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:'#e8edf5'}}>{p.actividad}</div>
                      <div style={{fontSize:9,color:'rgba(255,255,255,0.3)',marginTop:1}}>{p.fecha}</div>
                    </div>
                  ))}
                </div>}
              </div>
            )}

            {modo==='jugador' && (
              <>
                <div style={{background:'#0e1220',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,padding:'14px'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.42)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:10}}>Jugador</div>
                  <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:180,overflowY:'auto'}}>
                    {playersWithACWR.map(p=>(
                      <div key={p.id} onClick={()=>{setJugSelec(p.id);setDiasSelec([]);setPreview(false);}} style={{
                        display:'flex',alignItems:'center',gap:7,padding:'6px 9px',borderRadius:7,cursor:'pointer',
                        background:jugSelec===p.id?`${statusCfg[p.status].color}12`:'rgba(255,255,255,0.02)',
                        border:`1px solid ${jugSelec===p.id?statusCfg[p.status].color+'40':'rgba(255,255,255,0.04)'}`}}>
                        <div style={{width:4,height:4,borderRadius:'50%',background:statusCfg[p.status].color}}/>
                        <span style={{flex:1,fontSize:11,fontWeight:600,color:'#e8edf5'}}>{p.nombre}</span>
                        <span style={{fontSize:9,color:'rgba(255,255,255,0.3)'}}>{p.pos}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{background:'#0e1220',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,padding:'14px'}}>
                  <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,0.42)',textTransform:'uppercase',letterSpacing:'0.1em',marginBottom:6}}>
                    Sesiones <span style={{color:'rgba(255,255,255,0.25)',fontWeight:400}}>({diasSelec.length===0?'última':diasSelec.length+' sel.'})</span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:200,overflowY:'auto'}}>
                    {diasJugador.map((f,i)=>{
                      const act = gpsData.find(r => r.Fecha===f && (r.Jugador||'').toLowerCase().includes((jugadorActual?.nombre||'').toLowerCase().split(' ')[0].toLowerCase()))?.Actividad || f;
                      return (
                        <div key={i} onClick={()=>toggleDia(f)} style={{
                          display:'flex',alignItems:'center',gap:7,padding:'6px 9px',borderRadius:7,cursor:'pointer',
                          background:diasSelec.includes(f)?'rgba(0,230,118,0.08)':'rgba(255,255,255,0.02)',
                          border:`1px solid ${diasSelec.includes(f)?'rgba(0,230,118,0.3)':'rgba(255,255,255,0.04)'}`}}>
                          <div style={{width:10,height:10,borderRadius:2,border:`1.5px solid ${diasSelec.includes(f)?'#00e676':'rgba(255,255,255,0.3)'}`,background:diasSelec.includes(f)?'#00e676':'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:7,color:'#000',flexShrink:0}}>{diasSelec.includes(f)?'✓':''}</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:10,color:'#e8edf5',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{act}</div>
                            <div style={{fontSize:8,color:'rgba(255,255,255,0.3)'}}>{f}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <button onClick={()=>{setGenerando(true);setTimeout(()=>{setGenerando(false);setPreview(true);},800);}} disabled={generando} style={{
              padding:'11px',borderRadius:11,fontSize:13,fontWeight:800,cursor:'pointer',
              background:generando?'rgba(0,230,118,0.3)':'#00e676',color:'#06080f',border:'none',letterSpacing:'0.04em'}}>
              {generando?'⏳ Generando...':'⊞ Generar Informe'}
            </button>
            {preview && (
              <button onClick={imprimirPDF} style={{
                padding:'9px',borderRadius:11,fontSize:12,fontWeight:700,cursor:'pointer',
                background:'transparent',color:'#40c4ff',border:'1px solid rgba(64,196,255,0.3)'}}>
                🖨 Imprimir / Guardar PDF
              </button>
            )}
          </div>

          {/* Preview */}
          <div style={{background:'#f1f5f9',borderRadius:14,minHeight:500,overflow:'auto',border:'1px solid rgba(255,255,255,0.06)'}}>
            {!preview ? (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',minHeight:460,gap:12}}>
                <div style={{fontSize:48}}>⊞</div>
                <div style={{fontSize:14,fontWeight:600,color:'rgba(255,255,255,0.4)'}}>Vista previa del informe</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.2)',textAlign:'center',maxWidth:240}}>
                  {modo==='partido'?'Selecciona un partido':'Selecciona jugador y sesiones'}
                </div>
              </div>
            ) : modo==='partido' ? <InformePartido/> : <InformeJugador/>}
          </div>
        </div>
      </div>
    );
  };


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
          <div style={{fontSize:9,color:C.muted,letterSpacing:"0.08em",marginTop:3,textTransform:"uppercase"}}>Orsomarso SC · BCA 2026-1</div>
        </div>
        <nav style={S.nav}>
          {navItems.map(item=>(
            <div key={item.id} style={S.navItem(page===item.id)} onClick={()=>setPage(item.id)}>
              <span style={{fontFamily:"monospace",fontSize:13,width:16,textAlign:"center"}}>{item.icon}</span>
              <span>{item.label}</span>
              {item.id==="importar" && (catRaw||wysRaw||gConnected) &&
                <span style={{marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:C.green}}/>}
              {item.id==="semaforo" && playersWithACWR.some(p=>p.acwr>1.5) &&
                <span style={{marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:C.red}}/>}
            </div>
          ))}
        </nav>
        <div style={{padding:"14px 18px",borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:9,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em"}}>Fuentes activas</div>
          <div style={{marginTop:6,display:"flex",flexDirection:"column",gap:4}}>
            {[{label:"GPS",color:(catRaw||gpsConnected)?C.green:C.dim},{label:"Wyscout",color:wysRaw?C.blue:C.dim},{label:"Wellness",color:gConnected?C.purple:C.dim}].map((s,i)=>(
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
        {page==="semaforo"  && <PageSemaforo/>}
        {page==="plantilla" && <PagePlantilla/>}
        {page==="carga"     && <PageCarga/>}
        {page==="informes"  && <PageInformes/>}
        {page==="importar"  && <PageImportar/>}
        {page==="wellness"  && <PageWellness/>}
      </main>
    </div>
  );
}
