import sqlite3,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from db import connect,init,load_patients,load_slots
from engine import match
from server import Demo
class SqliteTests(unittest.TestCase):
 def test_two_clinics_and_names(self):
  init()
  with connect() as c:
   self.assertEqual(c.execute('SELECT COUNT(*) FROM clinics').fetchone()[0],2)
   self.assertEqual(c.execute('SELECT COUNT(*) FROM patients').fetchone()[0],500)
   self.assertEqual(c.execute('SELECT COUNT(*) FROM historical_demo_appointments').fetchone()[0],160)
   self.assertTrue(all(' ' in r['display_name'] for r in c.execute('SELECT display_name FROM patients')))
 def test_matching_unchanged(self):
  d=Demo();d.cancel('S001')
  self.assertEqual(len(d.candidates('S001')['eligible']),29)
  self.assertIn('display_name',d.candidates('S001')['eligible'][0])
 def test_patient_only_own_name(self):
  d=Demo();p=load_patients()[0]
  self.assertEqual(d.patient_state(p['patient_id'])['patient']['display_name'],p['display_name'])
if __name__=='__main__':unittest.main()
