"""
PerfLoad · GPS Upload v5
Uso: python upload_gps.py archivo.csv
"""

import csv, json, sys
import urllib.request, urllib.parse

GPS_SCRIPT_URL = (
    "https://script.google.com/macros/s/"
    "AKfycbwDGijP4r1b7vRqLWx_FzdbPLTlunnO1kNEgZQ-AkOqc2Atk8Py6lsuxamNWPVmfEsH"
    "/exec"
)

COLS = [
    "Fecha","Actividad","Jugador","Posicion","Duracion",
    "Distancia","PlayerLoad","VelMax","PctVelMax","MPM",
    "HSR","Sprint","DistSprint","NSprintsH",
    "AcelsM","AcelsH","DecelsM","DecelsH",
    "HMLD","HRprom","HRmax"
]

def read_csv(filepath):
    rows = []
    with open(filepath, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not row.get("Jugador") or not row.get("Fecha"):
                continue
            clean = {col: row.get(col, "").strip() for col in COLS}
            rows.append(clean)
    return rows

def upload_batch(batch, batch_num):
    data_enc = urllib.parse.quote(json.dumps(batch, ensure_ascii=False))
    url = f"{GPS_SCRIPT_URL}?action=append&data={data_enc}"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = resp.read().decode("utf-8").strip().lstrip('\ufeff')
            return json.loads(body)
    except urllib.error.HTTPError as e:
        return {"status": "error", "msg": f"HTTP {e.code}"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}

def upload(rows, batch_size=5):
    total = 0
    last_row = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i+batch_size]
        n = i//batch_size + 1
        result = upload_batch(batch, n)
        if result.get("status") == "ok":
            total += result.get("appended", 0)
            last_row = result.get("lastRow", 0)
            print(f"  Lote {n}: {result.get('appended')} filas OK (total sheet: {last_row})")
        else:
            print(f"  Lote {n} ERROR: {result.get('msg')}")
            return None
    return {"status": "ok", "appended": total, "lastRow": last_row}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python upload_gps.py <archivo.csv>")
        sys.exit(1)

    filepath = sys.argv[1]
    print(f"Leyendo: {filepath}")
    rows = read_csv(filepath)
    print(f"Filas validas: {len(rows)}")

    if not rows:
        print("Sin filas validas. Abortando.")
        sys.exit(1)

    print(f"Enviando en lotes de 5...")
    result = upload(rows)

    if result and result.get("status") == "ok":
        print(f"\nExito: {result.get('appended')} filas agregadas")
        print(f"Sheet GPS ahora tiene {result.get('lastRow')} filas totales")
    else:
        print(f"\nError en la subida.")
        sys.exit(1)

