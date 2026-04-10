"""
Actualiza la URL de APPS_SCRIPT_URL en App.js y perfload-form.html
"""
import re

NEW_URL = "https://script.google.com/macros/s/AKfycbwVYn95254U_VWqhgbPlI_Z6Db4oiucpsQaCmU13dgL0qDctNdY418ONzYP9lpjQgRn/exec"

files = [
    "src/App.js",
    "public/perfload-form.html"
]

for filepath in files:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Reemplazar solo APPS_SCRIPT_URL, no GPS_SCRIPT_URL
        new_content = re.sub(
            r'(const APPS_SCRIPT_URL\s*=\s*")[^"]+(")',
            rf'\g<1>{NEW_URL}\g<2>',
            content
        )

        if new_content != content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"✅ {filepath} actualizado")
        else:
            print(f"⚠️  {filepath} — no se encontró APPS_SCRIPT_URL")

    except FileNotFoundError:
        print(f"❌ {filepath} no encontrado")

print("\nVerifica con: findstr APPS_SCRIPT_URL src\\App.js")
