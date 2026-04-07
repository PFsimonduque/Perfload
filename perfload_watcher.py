"""
PerfLoad · GPS Auto-Uploader
════════════════════════════
Monitorea la carpeta 'GPS_SUBIR' y procesa automáticamente
cualquier ZIP de Catapult que pongas ahí.

USO:
    1. Ejecuta este script: python perfload_watcher.py
    2. Arrastra cualquier ZIP de Catapult a la carpeta GPS_SUBIR
    3. El script lo procesa y sube al Sheet automáticamente
    4. El ZIP se mueve a GPS_PROCESADOS cuando termina

INSTALACIÓN ÚNICA:
    pip install watchdog
"""

import os, sys, csv, time, json, zipfile, shutil
import urllib.request, urllib.parse
from datetime import datetime
from pathlib import Path

# ── Configuración ─────────────────────────────────────
GPS_SCRIPT_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbyHeRLfOMWn8n-xISq5Fwcg3uTJrqNHe7T0-hXB2agjhDlOiYNUqnfuynbJMk4-P4I7"
    "/exec"
)

# Carpetas (se crean automáticamente)
BASE_DIR       = Path(__file__).parent
WATCH_DIR      = BASE_DIR / "GPS_SUBIR"       # arrastra ZIPs aquí
DONE_DIR       = BASE_DIR / "GPS_PROCESADOS"  # ZIPs procesados
LOG_FILE       = BASE_DIR / "perfload_log.txt"

COLS = [
    "Fecha","Actividad","Jugador","Posicion","Duracion",
    "Distancia","PlayerLoad","VelMax","PctVelMax","MPM",
    "HSR","Sprint","DistSprint","NSprintsH",
    "AcelsM","AcelsH","DecelsM","DecelsH",
    "HMLD","HRprom","HRmax"
]

# ── Helpers ────────────────────────────────────────────
def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def pf(v):
    try:
        s = str(v).strip()
        if not s: return 0
        if ':' in s:
            p = s.split(':')
            if len(p) == 3:
                return round(int(p[0])*60 + int(p[1]) + int(p[2])/60, 1)
        return round(float(s), 2)
    except:
        return 0

def parse_csv(filepath):
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        content = f.read()
    lines = content.split('\n')
    try:
        header_idx = next(i for i, l in enumerate(lines) if 'Player Name' in l)
    except:
        return []
    import csv as _csv
    reader = _csv.DictReader(lines[header_idx:])
    rows = []
    for row in reader:
        if row.get('Period Number', '') != '0':
            continue
        name = row.get('Player Name', '').strip()
        if not name:
            continue
        fecha_raw = row.get('Date', '')
        try:
            d, m, y = fecha_raw.split('/')
            fecha = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        except:
            fecha = fecha_raw
        rows.append({
            'Fecha':      fecha,
            'Actividad':  row.get('Activity Name', '').strip(),
            'Jugador':    name.title(),
            'Posicion':   row.get('Position Name', '').strip(),
            'Duracion':   pf(row.get('Total Duration', 0)),
            'Distancia':  pf(row.get('Total Distance', 0)),
            'PlayerLoad': pf(row.get('Total Player Load', 0)),
            'VelMax':     pf(row.get('Maximum Velocity', 0)),
            'PctVelMax':  pf(row.get('Max Vel (% Max)', 0)),
            'MPM':        pf(row.get('Meterage Per Minute', 0)),
            'HSR':        pf(row.get('Velocity Band 4 Total Distance', 0)),
            'Sprint':     pf(row.get('Velocity Band 5 Total Distance', 0)),
            'DistSprint': pf(row.get('Distancia en Sprint (m)', 0)),
            'NSprintsH':  pf(row.get('N Sprints +25km/h', 0)),
            'AcelsM':     pf(row.get('IMA Accel Medium', 0)),
            'AcelsH':     pf(row.get('IMA Accel High', 0)),
            'DecelsM':    pf(row.get('IMA Decel Medium', 0)),
            'DecelsH':    pf(row.get('IMA Decel High', 0)),
            'HMLD':       pf(row.get('HMLD (Gen 2)', 0)),
            'HRprom':     pf(row.get('Avg Heart Rate', 0)),
            'HRmax':      pf(row.get('Maximum Heart Rate', 0)),
        })
    return rows

def upload_rows(rows, batch_size=5):
    total = 0
    last_row = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        data_enc = urllib.parse.quote(json.dumps(batch, ensure_ascii=False))
        url = f"{GPS_SCRIPT_URL}?action=append&data={data_enc}"
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                body = resp.read().decode('utf-8').strip().lstrip('\ufeff')
                result = json.loads(body)
                if result.get('status') == 'ok':
                    total += result.get('appended', 0)
                    last_row = result.get('lastRow', 0)
                else:
                    log(f"  ⚠ Error lote {i//batch_size+1}: {result.get('msg','')}")
                    return None
        except Exception as e:
            log(f"  ⚠ Error lote {i//batch_size+1}: {e}")
            return None
    return {'appended': total, 'lastRow': last_row}

def process_zip(zip_path):
    zip_path = Path(zip_path)
    log(f"📦 Procesando: {zip_path.name}")
    
    # Extraer a carpeta temporal
    tmp_dir = BASE_DIR / "tmp_extract"
    tmp_dir.mkdir(exist_ok=True)
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            z.extractall(tmp_dir)
    except Exception as e:
        log(f"  ❌ Error extrayendo ZIP: {e}")
        return False
    
    # Parsear CSVs
    all_rows = []
    csv_files = list(tmp_dir.glob("*.csv"))
    log(f"  📄 {len(csv_files)} archivos CSV encontrados")
    
    for csv_file in sorted(csv_files):
        rows = parse_csv(str(csv_file))
        if rows:
            all_rows.extend(rows)
            log(f"  ✓ {csv_file.name[:50]}: {len(rows)} jugadores")
        else:
            log(f"  ○ {csv_file.name[:50]}: sin datos")
    
    # Limpiar temporal
    shutil.rmtree(tmp_dir)
    
    if not all_rows:
        log(f"  ⚠ No se encontraron datos en el ZIP")
        return False
    
    log(f"  📊 Total filas a subir: {len(all_rows)}")
    
    # Subir al Sheet
    result = upload_rows(all_rows)
    if result:
        log(f"  ✅ Éxito: {result['appended']} filas agregadas | Sheet total: {result['lastRow']} filas")
        # Mover ZIP a procesados
        dest = DONE_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{zip_path.name}"
        shutil.move(str(zip_path), str(dest))
        log(f"  📁 ZIP movido a GPS_PROCESADOS")
        return True
    else:
        log(f"  ❌ Error subiendo datos al Sheet")
        return False

def watch():
    # Crear carpetas si no existen
    WATCH_DIR.mkdir(exist_ok=True)
    DONE_DIR.mkdir(exist_ok=True)
    
    log("=" * 55)
    log("⬡ PERFLOAD GPS AUTO-UPLOADER — Iniciado")
    log(f"📂 Carpeta monitoreada: {WATCH_DIR}")
    log(f"📁 Procesados en: {DONE_DIR}")
    log("Arrastra ZIPs de Catapult a GPS_SUBIR para subir")
    log("Presiona Ctrl+C para detener")
    log("=" * 55)
    
    processed = set()
    
    while True:
        try:
            # Buscar ZIPs nuevos
            zips = list(WATCH_DIR.glob("*.zip"))
            for zip_path in zips:
                if zip_path.name not in processed:
                    processed.add(zip_path.name)
                    time.sleep(1)  # Esperar que termine de copiarse
                    if zip_path.exists():
                        process_zip(zip_path)
                        print()  # línea en blanco entre sesiones
            
            time.sleep(3)  # Revisar cada 3 segundos
            
        except KeyboardInterrupt:
            log("⬡ PerfLoad Watcher detenido.")
            break
        except Exception as e:
            log(f"⚠ Error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    watch()
