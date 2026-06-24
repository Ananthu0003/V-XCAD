import psycopg2
conn = psycopg2.connect('postgresql://cad_user:cad_pass@127.0.0.1:5433/cad_db')
cur = conn.cursor()
cur.execute('SELECT id, "pythonScript" FROM "CadSession" ORDER BY "updatedAt" DESC LIMIT 1')
row = cur.fetchone()
if row:
    with open('latest_script.py', 'w') as f:
        f.write(row[1])
    print(f"Wrote script {row[0]}")
else:
    print("No rows found")
