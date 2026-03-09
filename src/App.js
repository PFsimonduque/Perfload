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
  { id:1, nombre:"Hector Arango", pos:"POR", edad:28, peso:90.05, talla:194, loads:[40, 54, 305, 334, 222, 335, 396, 172, 295, 395, 60, 124, 357, 2, 342, 209, 384, 193, 267, 162, 97, 360, 361, 196], cat:{distancia:2092,playerLoad:195.5,velMax:14.9,mpm:28.1,hsr:0,sprint:0,sprintsN:0,acelsM:2,acelsH:0,decelsM:2,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:2, nombre:"Johan Grisales", pos:"POR", edad:21, peso:78.6, talla:187, loads:[158, 228, 218, 461, 240, 293, 369, 167, 41, 35, 352, 366, 220, 352, 217, 401, 381, 109, 117, 410, 385, 222, 233, 162, 293, 201, 202, 216, 163, 410, 138, 221, 530, 176, 2, 235, 302, 376], cat:{distancia:5193,playerLoad:375.7,velMax:24.8,mpm:52.3,hsr:0,sprint:0,sprintsN:0,acelsM:10,acelsH:6,decelsM:2,decelsH:3,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:3, nombre:"Edwin Martinez", pos:"LAT", edad:21, peso:86.3, talla:178, loads:[347, 417, 283, 506, 482, 561, 514, 334, 460, 149, 68, 400, 598, 421, 456, 1000, 288, 565, 320, 141, 984, 189, 201, 910, 150, 326, 308, 732, 289, 338, 318, 311, 913, 256, 798, 346, 856, 171, 394, 879], cat:{distancia:9413,playerLoad:878.6,velMax:32.6,mpm:94.9,hsr:358,sprint:0,sprintsN:18,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:4, nombre:"Deivi Barrios", pos:"DC", edad:21, peso:81.6, talla:183, loads:[336, 298, 340, 523, 433, 651, 550, 286, 371, 159, 73, 305, 539, 361, 332, 812, 219, 700, 399, 134, 745, 154, 239, 787, 142, 428, 327, 766, 233, 367, 288, 343, 846, 279, 892, 405, 720, 162, 312, 884], cat:{distancia:8389,playerLoad:883.7,velMax:29.4,mpm:84.6,hsr:108,sprint:0,sprintsN:5,acelsM:10,acelsH:8,decelsM:18,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:5, nombre:"Juan Salinas", pos:"DC", edad:18, peso:93.4, talla:195, loads:[285, 345, 303, 223, 420, 413, 467, 364, 387, 185, 62, 365, 542, 411, 411, 871, 282, 573, 325, 201, 869, 237, 290, 747, 170, 322, 345, 808, 324, 430, 325, 359, 868, 236, 784, 378, 735, 138, 130, 617], cat:{distancia:6407,playerLoad:616.8,velMax:31.0,mpm:85.5,hsr:76,sprint:0,sprintsN:5,acelsM:16,acelsH:12,decelsM:8,decelsH:3,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:6, nombre:"Victor Lasso", pos:"DC", edad:20, peso:74.2, talla:188, loads:[390, 385, 584, 361, 484, 363, 446, 369, 254, 308, 277, 436, 491, 479, 775], cat:{distancia:6762,playerLoad:775.4,velMax:32.2,mpm:95.8,hsr:163,sprint:0,sprintsN:10,acelsM:12,acelsH:10,decelsM:13,decelsH:9,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:7, nombre:"Nawer Vargas", pos:"DC", edad:21, peso:88.2, talla:196, loads:[268, 345, 338, 547, 401, 494, 507, 336, 288, 153, 62, 226, 547, 301, 175, 208, 270, 601, 333, 184, 828, 234, 264, 772, 130, 350, 322, 658, 316, 423, 319, 183, 276, 551, 217, 371, 340], cat:{distancia:3683,playerLoad:339.9,velMax:27.6,mpm:49.6,hsr:48,sprint:0,sprintsN:1,acelsM:4,acelsH:3,decelsM:8,decelsH:4,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:8, nombre:"Felipe Palomino", pos:"LAT", edad:21, peso:80.5, talla:185, loads:[934, 319, 491, 205, 150, 607, 182, 805, 249, 261, 800, 276, 313, 309, 688, 286, 581, 432, 786, 139, 338, 703], cat:{distancia:6871,playerLoad:703.3,velMax:30.9,mpm:91.7,hsr:146,sprint:0,sprintsN:6,acelsM:20,acelsH:10,decelsM:13,decelsH:6,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:9, nombre:"Jhon Barreiro", pos:"LAT", edad:20, peso:77.4, talla:186, loads:[317, 415, 295, 360, 460, 344, 474, 349, 358, 154, 58, 401, 607, 292, 431, 857, 353, 475, 354, 113, 758, 194, 239, 780, 338, 315, 913, 274, 451, 347, 361, 911, 258, 374, 422, 511, 192, 684, 158, 400, 795], cat:{distancia:8764,playerLoad:794.7,velMax:31.8,mpm:88.3,hsr:269,sprint:0,sprintsN:14,acelsM:12,acelsH:5,decelsM:18,decelsH:6,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:10, nombre:"Samuel Gonzalez", pos:"LAT", edad:21, peso:71.5, talla:179, loads:[140, 87, 375, 517, 213, 248, 556, 238, 350, 684, 322, 160, 359, 225, 267, 283, 327, 312, 319, 442, 336, 176, 293, 460, 251, 411, 337], cat:{distancia:3042,playerLoad:336.5,velMax:33.1,mpm:40.9,hsr:113,sprint:0,sprintsN:3,acelsM:4,acelsH:4,decelsM:12,decelsH:5,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:11, nombre:"Jerson Balanta", pos:"LAT", edad:17, peso:73.5, talla:182, loads:[267, 308, 293, 222, 352, 431, 247, 226, 133, 64, 409, 519, 311, 181, 503, 234, 305, 582, 330, 133, 234, 322, 298, 291, 318, 492, 319, 439, 295, 314, 372, 293, 380, 354, 148, 325], cat:{distancia:3353,playerLoad:325.1,velMax:24.5,mpm:60.5,hsr:0,sprint:0,sprintsN:0,acelsM:9,acelsH:4,decelsM:12,decelsH:6,actividad:"SESIÓN 39",fecha:"2026-03-03"}, wys:null },
  { id:12, nombre:"Luis Mosquera", pos:"LAT", edad:19, peso:71.6, talla:175, loads:[411, 451, 324, 371, 482, 415, 624, 364, 430, 166, 87, 429, 654, 414, 433, 454, 261, 461, 650, 408, 128, 294, 233, 283, 340, 336, 165, 465, 364, 512, 374, 357, 523, 188, 339, 680, 4], cat:{distancia:7288,playerLoad:680.4,velMax:28.9,mpm:95.3,hsr:55,sprint:0,sprintsN:4,acelsM:4,acelsH:6,decelsM:16,decelsH:8,actividad:"FECHA 5 VS REAL CUNDINAMARCA",fecha:"2026-02-22"}, wys:null },
  { id:13, nombre:"Santiago Agamez", pos:"MCD", edad:20, peso:73.2, talla:177, loads:[347, 363, 381, 299, 520, 569, 533, 409, 493, 137, 74, 415, 784, 406, 420, 602, 283, 385, 411, 169, 703, 228, 268, 867, 126, 368, 333, 756, 443, 427, 345, 1092, 885, 397, 569, 196, 642, 146, 428, 1021], cat:{distancia:9679,playerLoad:1021.2,velMax:28.2,mpm:97.6,hsr:60,sprint:0,sprintsN:3,acelsM:9,acelsH:8,decelsM:6,decelsH:7,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:14, nombre:"Dennis Matamba", pos:"MCD", edad:20, peso:79.7, talla:184, loads:[345, 365, 178, 410, 484, 447, 311, 383, 130, 73, 344, 461, 140, 208, 127, 317, 594, 329, 176, 369, 180, 191, 274, 337, 226, 337, 471, 380, 435, 318, 198, 242, 348, 260, 394, 398, 294], cat:{distancia:3174,playerLoad:293.6,velMax:26.4,mpm:113.5,hsr:6,sprint:0,sprintsN:0,acelsM:1,acelsH:1,decelsM:4,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:15, nombre:"Yeiner Valoyes", pos:"MCI", edad:20, peso:68.0, talla:170, loads:[403, 457, 403, 264, 609, 505, 345, 315, 360, 188, 55, 403, 547, 347, 271, 665, 276, 391, 734, 453, 280, 435, 295, 358, 363, 465, 327, 404, 564, 270, 521, 449, 228, 243, 355, 110, 516, 444], cat:{distancia:4052,playerLoad:444.0,velMax:31.4,mpm:54.5,hsr:99,sprint:0,sprintsN:7,acelsM:9,acelsH:5,decelsM:8,decelsH:4,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:16, nombre:"Kevin Gomez", pos:"MCI", edad:30, peso:72.8, talla:170, loads:[393, 420, 359, 486, 610, 476, 415, 318, 284, 181, 69, 380, 667, 233, 295, 214, 606, 378, 247, 329, 172, 327, 451, 456, 425, 403, 271, 618, 486, 472, 406, 225, 286, 348, 550, 301], cat:{distancia:2591,playerLoad:301.5,velMax:20.4,mpm:34.9,hsr:0,sprint:0,sprintsN:0,acelsM:2,acelsH:1,decelsM:8,decelsH:2,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:17, nombre:"Jhoiner Zarante", pos:"MCI", edad:18, peso:76.8, talla:178, loads:[297, 334, 232, 502, 563, 505, 348, 406, 116, 71, 385, 621, 365, 324, 878, 220, 137, 394, 187, 184, 266, 327, 274, 115, 386, 393, 313, 160, 273, 287, 297, 98, 361, 274, 256], cat:{distancia:2683,playerLoad:255.7,velMax:26.4,mpm:111.9,hsr:15,sprint:0,sprintsN:1,acelsM:3,acelsH:6,decelsM:5,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:18, nombre:"Jader Contreras", pos:"MCO", edad:18, peso:70.9, talla:178, loads:[379, 422, 462, 267, 583, 528, 513, 402, 537, 135, 39, 366, 755, 304, 357, 110, 293, 178, 98, 218, 211, 421, 272, 115, 492, 335, 453, 315, 176, 263, 363, 498, 153, 460], cat:{distancia:4117,playerLoad:460.4,velMax:23.6,mpm:74.3,hsr:0,sprint:0,sprintsN:0,acelsM:14,acelsH:6,decelsM:16,decelsH:2,actividad:"SESIÓN 39",fecha:"2026-03-03"}, wys:null },
  { id:19, nombre:"Josue Villareal", pos:"MCO", edad:19, peso:75.2, talla:183, loads:[269, 375, 170, 521, 249, 149, 52, 404, 597, 347, 236, 198, 286, 293, 39, 121, 264, 146, 171, 65, 227, 134, 188, 97, 186, 105, 291, 4, 399, 280], cat:{distancia:2660,playerLoad:280.4,velMax:24.2,mpm:35.8,hsr:0,sprint:0,sprintsN:0,acelsM:7,acelsH:4,decelsM:11,decelsH:5,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:20, nombre:"Maicol Preciado", pos:"EXT", edad:20, peso:69.0, talla:174, loads:[377, 420, 426, 289, 554, 499, 545, 393, 332, 155, 78, 425, 472, 302, 312, 300, 383, 617, 349, 155, 233, 291, 419, 365, 341, 143, 597, 291, 0, 269, 525, 90, 391], cat:{distancia:3559,playerLoad:391.2,velMax:27.1,mpm:64.2,hsr:16,sprint:0,sprintsN:1,acelsM:2,acelsH:6,decelsM:10,decelsH:6,actividad:"SESIÓN 39",fecha:"2026-03-03"}, wys:null },
  { id:21, nombre:"Andres Ruiz", pos:"MCI", edad:21, peso:68.0, talla:170, loads:[273, 495, 509, 112, 530, 335, 279, 141, 75, 396, 397, 349, 1031, 314, 443, 165, 191, 169, 127, 269, 343, 337, 304, 704, 356, 507, 367, 392, 860, 199, 719, 426, 846, 153, 435, 1108], cat:{distancia:10880,playerLoad:1108.1,velMax:29.7,mpm:109.7,hsr:96,sprint:0,sprintsN:4,acelsM:19,acelsH:9,decelsM:13,decelsH:5,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:22, nombre:"Eder Torres", pos:"MCI", edad:16, peso:68.3, talla:172, loads:[371, 429, 460, 247, 564, 561, 539, 382, 286, 158, 62, 467, 774, 366, 473, 448, 389, 657, 397, 161, 594, 177, 209, 342, 318, 125, 639, 431, 595, 354, 336, 208, 355, 458, 175, 441, 323, 322], cat:{distancia:2776,playerLoad:322.1,velMax:29.1,mpm:115.8,hsr:19,sprint:0,sprintsN:1,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:23, nombre:"Sebastian Girado", pos:"EXT", edad:21, peso:68.0, talla:168, loads:[316, 202, 205, 479, 495, 567, 357, 381, 141, 115, 440, 627, 354, 413, 757, 364, 661, 305, 156, 834, 182, 217, 883, 150, 353, 274, 836, 249, 518, 371, 354, 693, 2, 402, 370, 823, 154, 429, 742], cat:{distancia:7201,playerLoad:741.7,velMax:30.7,mpm:88.5,hsr:113,sprint:0,sprintsN:7,acelsM:21,acelsH:16,decelsM:13,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:24, nombre:"Johan Parra", pos:"EXT", edad:21, peso:63.0, talla:167, loads:[528, 280, 498, 428, 409, 357, 560, 146, 76, 559, 498, 124, 407, 817, 483, 156, 466, 232, 291, 372, 435, 412, 111, 602, 434, 435, 694, 360, 418, 675, 226, 302, 376, 567, 641, 170, 513, 392], cat:{distancia:3287,playerLoad:392.2,velMax:28.2,mpm:117.6,hsr:132,sprint:0,sprintsN:4,acelsM:8,acelsH:8,decelsM:3,decelsH:1,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:25, nombre:"Jose Hernandez", pos:"EXT", edad:17, peso:71.3, talla:173, loads:[415, 449, 452, 248, 629, 571, 642, 425, 165, 48, 484, 795, 400, 536, 885, 376, 844, 370, 207, 886, 230, 378, 918, 143, 305, 113, 635, 401, 622, 350, 427, 193, 286, 525, 273, 504, 320, 876], cat:{distancia:7707,playerLoad:875.6,velMax:32.9,mpm:108.3,hsr:190,sprint:0,sprintsN:6,acelsM:8,acelsH:5,decelsM:13,decelsH:2,actividad:"FECHA 8 VS REAL CARTAGENA",fecha:"2026-03-06"}, wys:null },
  { id:26, nombre:"Faver Aragon", pos:"EXT", edad:20, peso:74.9, talla:178, loads:[310, 347, 364, 230, 476, 382, 298, 266, 426, 162, 63, 342, 579, 211, 255, 616, 252, 197, 432, 142, 227, 309, 322, 295, 288, 491, 277, 521, 314, 183, 228, 350, 101, 395, 273], cat:{distancia:2609,playerLoad:272.7,velMax:25.5,mpm:35.1,hsr:3,sprint:0,sprintsN:0,acelsM:2,acelsH:1,decelsM:9,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:27, nombre:"Daniel Lourido", pos:"EXT", edad:21, peso:58.7, talla:170, loads:[356, 407, 397, 258, 375, 420, 356, 241, 223, 158, 111, 384, 635, 180, 325, 675, 315, 189, 420, 227, 289, 313, 379, 238, 271, 556, 301, 464, 321, 183, 281, 459, 193, 414, 273], cat:{distancia:2374,playerLoad:272.9,velMax:26.9,mpm:31.9,hsr:40,sprint:0,sprintsN:2,acelsM:0,acelsH:0,decelsM:0,decelsH:0,actividad:"SESIÓN 40",fecha:"2026-03-04"}, wys:null },
  { id:28, nombre:"Santiago Arrechea", pos:"DEL", edad:19, peso:85.5, talla:181, loads:[367, 424, 468, 285, 521, 716, 624, 336, 566, 193, 131, 461, 655, 397, 275, 936, 350, 635, 398, 185, 172, 144, 209, 354, 413, 354, 765, 391, 508, 455, 440, 910, 385, 1015, 665], cat:{distancia:6373,playerLoad:664.6,velMax:30.1,mpm:84.9,hsr:98,sprint:0,sprintsN:4,acelsM:9,acelsH:8,decelsM:13,decelsH:4,actividad:"FECHA 7 VS ENVIGADO FC 2026-1",fecha:"2026-03-01"}, wys:null },
  { id:29, nombre:"Sergio Martinez", pos:"DEL", edad:17, peso:74.6, talla:179, loads:[665, 324, 202, 219, 292, 599, 152, 306, 126, 467, 364, 26, 0, 559, 318, 332, 276, 185, 338, 472], cat:{distancia:3594,playerLoad:472.5,velMax:25.0,mpm:76.0,hsr:2,sprint:0,sprintsN:0,acelsM:13,acelsH:3,decelsM:22,decelsH:8,actividad:"25 feb. M8 S34 EJECUCIÓN",fecha:"2026-02-25"}, wys:null },
];

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
  const wellnessData                = useState(SEED_WELLNESS)[0];
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
      const w = wellnessData.find(w => w.jugador === p.nombre);
      if (a < 0.8 || a > 1.5 || (w && (w.fatiga >= 7 || w.dolor >= 6))) return "risk";
      if (a < 0.94 || a > 1.35 || (w && (w.fatiga >= 5 || w.dolor >= 4))) return "caution";
      return "optimal";
    })(),
    wellness: wellnessData.find(w => w.jugador === p.nombre) || null,
  }));

  const statusCount = playersWithACWR.reduce((a,p)=>{ a[p.status]=(a[p.status]||0)+1; return a; },{});
  const avgACWR = parseFloat((playersWithACWR.reduce((a,p)=>a+p.acwr,0)/playersWithACWR.length).toFixed(2));
  // computed team load (available if needed)
  const TIPOS_SESION = ["MD-4","MD-3","MD-2","MD-1","MD","MD+1"];

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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <div style={S.sec}>GPS Catapult</div>
              {!p.cat && <Tag label="Sin datos — sube CSV" color={C.muted}/>}
              {p.cat  && <Tag label="✓ Datos reales" color={C.green}/>}
            </div>
            {[
              { label:"Distancia total",      val: p.cat ? `${Math.round(p.cat.distancia||0).toLocaleString()} m`  : "—", pct: p.cat ? Math.min(100,Math.round((p.cat.distancia||0)/120)) : 60, color:C.green },
              { label:"Player Load",          val: p.cat ? `${Math.round(p.cat.playerLoad||0)} UA`                 : `${p.loads[p.loads.length-1]||380} UA`, pct: p.cat ? Math.min(100,Math.round((p.cat.playerLoad||0)/12)) : 76, color:C.red },
              { label:"Vel. máx",             val: p.cat ? `${(p.cat.velMax||0).toFixed(1)} km/h`                 : "—", pct: p.cat ? Math.min(100,Math.round((p.cat.velMax||0)*3)) : 65, color:C.blue  },
              { label:"m/min",                val: p.cat ? `${Math.round(p.cat.mpm||0)} m/min`                    : "—", pct: p.cat ? Math.min(100,Math.round((p.cat.mpm||0)/1.2)) : 70, color:C.purple},
              { label:"HSR (+19.8 km/h)",     val: p.cat ? `${Math.round(p.cat.hsr||0)} m`                       : "—", pct: p.cat ? Math.min(100,Math.round((p.cat.hsr||0)/6)) : 68, color:C.blue  },
              { label:"Sprint (+25 km/h)",    val: p.cat ? `${Math.round(p.cat.sprint||0)} m · ${p.cat.sprintsN||0} esf` : "—", pct: p.cat ? Math.min(100,Math.round((p.cat.sprint||0)/3)) : 55, color:C.purple},
              { label:"Acel (med+alto)",      val: p.cat ? `${p.cat.acelsM||0}m + ${p.cat.acelsH||0}a`           : "48",  pct:74, color:C.yellow},
              { label:"Decel (med+alto)",     val: p.cat ? `${p.cat.decelsM||0}m + ${p.cat.decelsH||0}a`         : "52",  pct:78, color:C.orange},
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
    const [tipoInforme, setTipoInforme] = useState("individual");
    const [jugSelec, setJugSelec] = useState(playersWithACWR[0]?.id || null);
    const [jugMulti, setJugMulti] = useState([]);
    const [tipoSesion, setTipoSesion] = useState("MD-1");
    const [generando, setGenerando] = useState(false);
    const [preview, setPreview] = useState(false);

    const jugadorActual = playersWithACWR.find(p => p.id === jugSelec);
    const jugadoresSelec = tipoInforme === "individual"
      ? (jugadorActual ? [jugadorActual] : [])
      : jugMulti.length > 0
        ? playersWithACWR.filter(p => jugMulti.includes(p.id))
        : playersWithACWR;

    const toggleJugMulti = (id) => {
      setJugMulti(prev => prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id]);
    };

    const generarPDF = () => {
      setGenerando(true);
      setTimeout(() => {
        setGenerando(false);
        setPreview(true);
      }, 1800);
    };

    const MetricRow = ({ label, val, prev, color, unit="" }) => {
      const diff = prev ? val - prev : 0;
      const up = diff > 0;
      return (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
          padding:"7px 0", borderBottom:`1px solid ${C.border}` }}>
          <span style={{ fontSize:11, color:C.muted }}>{label}</span>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {prev !== undefined && (
              <span style={{ fontSize:10, color: up ? C.green : C.red }}>
                {up ? "▲" : "▼"} {Math.abs(diff).toFixed(0)}{unit}
              </span>
            )}
            <span style={{ fontSize:13, fontWeight:700, fontFamily:"monospace", color }}>{val}{unit}</span>
          </div>
        </div>
      );
    };

    return (
      <div>
        <div style={{ fontSize:24, fontWeight:800, letterSpacing:"-0.025em", marginBottom:6 }}>Informes PDF</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:22 }}>
          Genera informes individuales o grupales por tipo de sesión
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"320px 1fr", gap:16 }}>
          {/* Panel de configuración */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Tipo de informe */}
            <div style={S.card()}>
              <div style={{ ...S.sec, marginBottom:10 }}>Tipo de informe</div>
              <div style={{ display:"flex", gap:6 }}>
                {[["individual","Individual"],["grupal","Grupal / Equipo"]].map(([v,l]) => (
                  <button key={v} onClick={() => setTipoInforme(v)} style={{
                    flex:1, padding:"8px", borderRadius:9, fontSize:11, fontWeight:700,
                    cursor:"pointer", border:`1px solid ${tipoInforme===v?C.green+"50":C.border}`,
                    background: tipoInforme===v ? `${C.green}15` : "transparent",
                    color: tipoInforme===v ? C.green : C.muted }}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de sesión */}
            <div style={S.card()}>
              <div style={{ ...S.sec, marginBottom:10 }}>Tipo de sesión</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {TIPOS_SESION.map(t => (
                  <button key={t} onClick={() => setTipoSesion(t)} style={{
                    padding:"5px 12px", borderRadius:8, fontSize:11, fontWeight:700,
                    cursor:"pointer", border:`1px solid ${tipoSesion===t?C.blue+"50":C.border}`,
                    background: tipoSesion===t ? `${C.blue}15` : "transparent",
                    color: tipoSesion===t ? C.blue : C.muted }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Selección jugadores */}
            <div style={S.card()}>
              <div style={{ ...S.sec, marginBottom:10 }}>
                {tipoInforme === "individual" ? "Jugador" : `Jugadores (${jugMulti.length===0?"todos":jugMulti.length})`}
              </div>
              {tipoInforme === "individual" ? (
                <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:260, overflowY:"auto" }}>
                  {playersWithACWR.map(p => (
                    <div key={p.id} onClick={() => setJugSelec(p.id)} style={{
                      display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                      borderRadius:8, cursor:"pointer",
                      background: jugSelec===p.id ? `${statusCfg[p.status].color}15` : "rgba(255,255,255,0.02)",
                      border:`1px solid ${jugSelec===p.id ? statusCfg[p.status].color+"40" : C.border}` }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:statusCfg[p.status].color, flexShrink:0 }}/>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:600 }}>{p.nombre}</div>
                        <div style={{ fontSize:9, color:C.muted }}>{p.pos}</div>
                      </div>
                      <div style={{ fontSize:10, fontFamily:"monospace", color:acwrColor(p.acwr) }}>{p.acwr}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:200, overflowY:"auto", marginBottom:8 }}>
                    {playersWithACWR.map(p => (
                      <div key={p.id} onClick={() => toggleJugMulti(p.id)} style={{
                        display:"flex", alignItems:"center", gap:8, padding:"7px 10px",
                        borderRadius:8, cursor:"pointer",
                        background: jugMulti.includes(p.id) ? `${C.green}10` : "rgba(255,255,255,0.02)",
                        border:`1px solid ${jugMulti.includes(p.id) ? C.green+"40" : C.border}` }}>
                        <div style={{ width:14, height:14, borderRadius:4, border:`1.5px solid ${jugMulti.includes(p.id)?C.green:C.muted}`,
                          background: jugMulti.includes(p.id) ? C.green : "transparent",
                          display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, color:"#000", flexShrink:0 }}>
                          {jugMulti.includes(p.id) ? "✓" : ""}
                        </div>
                        <div style={{ flex:1, fontSize:11, fontWeight:600 }}>{p.nombre}</div>
                        <div style={{ fontSize:9, color:C.muted }}>{p.pos}</div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setJugMulti([])} style={{
                    width:"100%", padding:"6px", borderRadius:8, fontSize:10, fontWeight:700,
                    background:"transparent", border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer" }}>
                    Seleccionar todos
                  </button>
                </div>
              )}
            </div>

            {/* Botón generar */}
            <button onClick={generarPDF} disabled={generando} style={{
              width:"100%", padding:"12px", borderRadius:12, fontSize:13, fontWeight:800,
              background: generando ? `${C.green}40` : C.green,
              color:"#06080f", border:"none", cursor:generando?"not-allowed":"pointer",
              letterSpacing:"0.04em" }}>
              {generando ? "⏳ Generando informe..." : "⊞ Generar Informe PDF"}
            </button>
          </div>

          {/* Vista previa del informe */}
          <div style={{ ...S.card(), minHeight:500 }}>
            {!preview ? (
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center",
                justifyContent:"center", height:"100%", minHeight:460, gap:12, color:C.muted }}>
                <div style={{ fontSize:40 }}>⊞</div>
                <div style={{ fontSize:14, fontWeight:600 }}>Vista previa del informe</div>
                <div style={{ fontSize:11, textAlign:"center", maxWidth:260, lineHeight:1.6 }}>
                  Selecciona el tipo de informe, sesión y jugadores, luego haz clic en "Generar"
                </div>
              </div>
            ) : (
              <div>
                {/* Informe header */}
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start",
                  marginBottom:20, paddingBottom:16, borderBottom:`1px solid ${C.border}` }}>
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.12em", color:C.green, textTransform:"uppercase" }}>
                      ⬡ PERFLOAD · Informe de Carga
                    </div>
                    <div style={{ fontSize:18, fontWeight:800, marginTop:4 }}>
                      {tipoInforme === "individual" ? jugadorActual?.nombre : `Informe Grupal — ${jugadoresSelec.length} jugadores`}
                    </div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>
                      Sesión: <span style={{ color:C.blue, fontWeight:700 }}>{tipoSesion}</span> ·
                      {new Date().toLocaleDateString("es-CO", {weekday:"long",year:"numeric",month:"long",day:"numeric"})}
                    </div>
                  </div>
                  <button onClick={() => {
                    const content = document.getElementById("informe-preview");
                    if (content) {
                      const w = window.open("","_blank");
                      w.document.write(`<html><head><title>PerfLoad Informe</title>
                        <style>body{font-family:sans-serif;padding:24px;background:#fff;color:#111;}
                        table{width:100%;border-collapse:collapse;margin:12px 0;}
                        th{background:#f0f0f0;padding:8px;text-align:left;font-size:11px;}
                        td{padding:8px;border-bottom:1px solid #eee;font-size:12px;}
                        h1{font-size:20px;margin-bottom:4px;}h2{font-size:14px;color:#555;margin:16px 0 8px;}
                        .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;}
                        </style></head><body>${content.innerHTML}</body></html>`);
                      w.document.close();
                      w.print();
                    }
                  }} style={{
                    padding:"8px 16px", borderRadius:9, fontSize:11, fontWeight:700,
                    background:`${C.green}18`, color:C.green, border:`1px solid ${C.green}30`,
                    cursor:"pointer" }}>
                    🖨 Imprimir / PDF
                  </button>
                </div>

                <div id="informe-preview">
                  {tipoInforme === "individual" && jugadorActual ? (
                    <div>
                      {/* Individual report */}
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                        {[
                          { label:"ACWR", val:jugadorActual.acwr, color:acwrColor(jugadorActual.acwr) },
                          { label:"Estado", val:statusCfg[jugadorActual.status].label, color:statusCfg[jugadorActual.status].color },
                          { label:"Posición", val:jugadorActual.pos, color:C.text },
                        ].map((k,i) => (
                          <div key={i} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10,
                            padding:"12px", border:`1px solid ${C.border}`, textAlign:"center" }}>
                            <div style={{ fontSize:20, fontWeight:900, color:k.color, fontFamily:"monospace" }}>{k.val}</div>
                            <div style={{ fontSize:9, color:C.muted, marginTop:3, textTransform:"uppercase", letterSpacing:"0.08em" }}>{k.label}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ ...S.sec, marginBottom:10 }}>Métricas GPS · Sesión {tipoSesion}</div>
                      {[
                        { label:"Distancia total", val:jugadorActual.cat?.distancia || Math.round((jugadorActual.loads.slice(-1)[0]||380)*28), prev: Math.round((jugadorActual.loads.slice(-2,-1)[0]||360)*28), color:C.green, unit:" m" },
                        { label:"HSR (>18 km/h)", val:jugadorActual.cat?.hsr || 1240, prev:1180, color:C.blue, unit:" m" },
                        { label:"Sprint (>24 km/h)", val:jugadorActual.cat?.sprint || 380, prev:420, color:C.purple, unit:" m" },
                        { label:"Aceleraciones", val:jugadorActual.cat?.acels || 48, prev:44, color:C.yellow, unit:"" },
                        { label:"Player Load", val:jugadorActual.loads.slice(-1)[0] || 380, prev:jugadorActual.loads.slice(-2,-1)[0]||360, color:C.orange, unit:" UA" },
                      ].map((m,i) => <MetricRow key={i} {...m}/>)}

                      <div style={{ ...S.sec, marginTop:16, marginBottom:10 }}>Tendencia carga — últimos 7 días</div>
                      <div style={{ display:"flex", gap:6 }}>
                        {jugadorActual.loads.slice(-7).map((v,i) => {
                          const max = Math.max(...jugadorActual.loads.slice(-7));
                          const pct = (v/max)*100;
                          return (
                            <div key={i} style={{ flex:1, textAlign:"center" }}>
                              <div style={{ height:50, display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
                                <div style={{ width:"70%", height:`${pct}%`, minHeight:4,
                                  background:acwrColor(jugadorActual.acwr), borderRadius:"3px 3px 0 0", opacity:0.8 }}/>
                              </div>
                              <div style={{ fontSize:8, color:C.muted, marginTop:3 }}>D{i+1}</div>
                              <div style={{ fontSize:9, fontFamily:"monospace", color:C.text }}>{v}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Group report */}
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
                        {[
                          { label:"Jugadores", val:jugadoresSelec.length, color:C.text },
                          { label:"ACWR Promedio", val:parseFloat((jugadoresSelec.reduce((a,p)=>a+p.acwr,0)/jugadoresSelec.length).toFixed(2)), color:acwrColor(jugadoresSelec.reduce((a,p)=>a+p.acwr,0)/jugadoresSelec.length) },
                          { label:"En riesgo", val:jugadoresSelec.filter(p=>p.status==="risk").length, color:C.red },
                        ].map((k,i) => (
                          <div key={i} style={{ background:"rgba(255,255,255,0.03)", borderRadius:10,
                            padding:"12px", border:`1px solid ${C.border}`, textAlign:"center" }}>
                            <div style={{ fontSize:24, fontWeight:900, color:k.color, fontFamily:"monospace" }}>{k.val}</div>
                            <div style={{ fontSize:9, color:C.muted, marginTop:3, textTransform:"uppercase", letterSpacing:"0.08em" }}>{k.label}</div>
                          </div>
                        ))}
                      </div>

                      <div style={{ ...S.sec, marginBottom:10 }}>Resumen plantilla · Sesión {tipoSesion}</div>
                      <div style={{ overflowX:"auto" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead>
                            <tr>{["Jugador","Pos","ACWR","P.Load","Distancia","HSR","Estado"].map(h=>(
                              <th key={h} style={S.th}>{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {jugadoresSelec.map(p => {
                              const sc = statusCfg[p.status];
                              return (
                                <tr key={p.id}>
                                  <td style={{ ...S.td, fontWeight:700 }}>{p.nombre}</td>
                                  <td style={{ ...S.td, color:C.muted }}>{p.pos}</td>
                                  <td style={{ ...S.td, fontFamily:"monospace", fontWeight:700, color:acwrColor(p.acwr) }}>{p.acwr}</td>
                                  <td style={{ ...S.td, fontFamily:"monospace" }}>{p.loads.slice(-1)[0]||"—"}</td>
                                  <td style={{ ...S.td, fontFamily:"monospace" }}>{p.cat?.distancia?.toLocaleString()||"—"}</td>
                                  <td style={{ ...S.td, fontFamily:"monospace" }}>{p.cat?.hsr||"—"}</td>
                                  <td style={S.td}><Tag label={sc.label} color={sc.color}/></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
