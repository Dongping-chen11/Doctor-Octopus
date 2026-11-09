"""Summary of synthetic data. Run: python inspect_database.py"""
from db import init,connect
init()
with connect() as db:
 for table in ['clinics','practitioners','patients','appointment_requests','appointments','historical_demo_appointments','offers']:
  print(f'{table:30} {db.execute("SELECT COUNT(*) FROM "+table).fetchone()[0]}')
 print('\nPer-clinic synthetic appointment history:')
 for row in db.execute('SELECT clinic_id, COUNT(*) AS n FROM historical_demo_appointments GROUP BY clinic_id'): print(dict(row))
 print('\nInteractive demo slots (first 12 shown):')
 for row in db.execute('SELECT id,clinic_id,status FROM appointments ORDER BY id LIMIT 12'): print(dict(row))

 print('\nPatient membership per clinic:')
 for row in db.execute('SELECT clinic_id, COUNT(*) AS n FROM clinic_patients GROUP BY clinic_id'): print(dict(row))
