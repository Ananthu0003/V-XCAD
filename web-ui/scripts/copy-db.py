import sqlite3

dest_db = r'c:\Projects\vexcad backup\web-ui\prisma\dev.db'
src_db = r'C:\Projects\Custom tool setup\dev.db'

def copy_table(src_conn, dest_conn, table_name, exclude_cols=[]):
    src_cols = [c[1] for c in src_conn.execute(f'PRAGMA table_info({table_name})').fetchall()]
    dest_cols = [c[1] for c in dest_conn.execute(f'PRAGMA table_info({table_name})').fetchall()]
    
    common_cols = [c for c in src_cols if c in dest_cols and c not in exclude_cols]
    if not common_cols:
        print(f"No common columns for {table_name}, skipping.")
        return
        
    query = f'SELECT {",".join(common_cols)} FROM {table_name}'
    rows = src_conn.execute(query).fetchall()
    print(f'Copying {len(rows)} rows for {table_name}...')
    
    if len(rows) > 0:
        placeholders = ','.join(['?'] * len(common_cols))
        dest_conn.executemany(f'INSERT INTO {table_name} ({",".join(common_cols)}) VALUES ({placeholders})', rows)

src = sqlite3.connect(src_db)
dest = sqlite3.connect(dest_db)

dest.execute('BEGIN TRANSACTION;')
try:
    copy_table(src, dest, 'Tool', ['toolNumber'])
    copy_table(src, dest, 'ToolGeometry')
    copy_table(src, dest, 'ToolOffset')
    copy_table(src, dest, 'Holder')
    copy_table(src, dest, 'ToolAssembly')
    copy_table(src, dest, 'ToolCuttingData')
    copy_table(src, dest, 'ToolCompatibility')
    dest.execute('COMMIT;')
    print('Success!')
except Exception as e:
    dest.execute('ROLLBACK;')
    print('Failed:', e)
