import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from db import connect,init,load_patients,load_slots
from server import Demo
class TwoClinicsTest(unittest.TestCase):
 def test_250_per_clinic(self):
  init()
  with connect() as c:
   counts=dict(c.execute('SELECT clinic_id, COUNT(*) FROM clinic_patients GROUP BY clinic_id'))
   self.assertEqual(counts,{'BETHESDA':250,'REVIVE':250})
   self.assertEqual(c.execute('SELECT COUNT(*) FROM patients').fetchone()[0],500)
 def test_eighty_live_schedule_records(self):
  self.assertEqual(len(load_slots()),80)
  d=Demo()
  for k in ('REVIVE','BETHESDA'):
   state=d.clinic_state(k)
   self.assertEqual(len(state['slots']),40)
   self.assertEqual(state['patients_at_clinic'],250)
   self.assertEqual({s['clinic_id'] for s in state['slots']},{k})
   self.assertGreaterEqual(len({s['start_at'][:10] for s in state['slots']}),2)
 def test_isolated_clinic_state_after_cancel(self):
  d=Demo();d.cancel('S001')
  self.assertEqual(d.clinic_state('REVIVE')['slots'][0]['status'],'open')
  self.assertNotIn('S001',{s['slot_id'] for s in d.clinic_state('BETHESDA')['slots']})
 def test_full_flow_still_works(self):
  d=Demo();d.cancel('S001');d.send('S001')
  o=next(iter(d.offers.values()));d.respond(o['id'],'accept',o['patient_id']);d.confirm('S001')
  self.assertEqual(d.clinic_state('REVIVE')['slots'][0]['status'],'confirmed')
  self.assertTrue(all(o['slot_id']!='S001' for o in d.clinic_state('BETHESDA')['offers']))
if __name__=='__main__':unittest.main()
