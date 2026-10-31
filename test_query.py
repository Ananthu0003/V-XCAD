import psycopg2
import os

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
cur.execute('SELECT id, prompt, "stlUrl", "stepUrl", "currentVersion" FROM "CadSession" WHERE id=%s', ('cmv484y260001ps014c6pqwyu',))
print("Session details:", cur.fetchall())
cur.execute('SELECT version, "stlUrl", "stepUrl" FROM "CadIteration" WHERE "sessionId"=%s ORDER BY version ASC', ('cmv484y260001ps014c6pqwyu',))
print("Iterations:", cur.fetchall())
