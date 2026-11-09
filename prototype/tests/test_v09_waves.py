import unittest
from server import Demo, PATIENTS
from engine import match
class WaveTests(unittest.TestCase):
 def setUp(self):
  self.d=Demo();self.d.cancel('S001');self.d.send('S001')
 def test_larger_pool_and_score_is_not_probability(self):
  self.assertEqual(len(PATIENTS),500)
  pool=self.d.candidates('S001')['eligible']
  self.assertGreaterEqual(len(pool),5)
  self.assertGreater(pool[0]['score'],70)
 def test_expiry_starts_next_three(self):
  first={o['patient_id'] for o in self.d.offers.values()}
  self.assertEqual(len(first),3)
  self.d.advance('S001',20)
  self.assertEqual(len([o for o in self.d.offers.values() if o['state']=='expired']),3)
  nextup={o['patient_id'] for o in self.d.offers.values() if o['state']=='offered'}
  self.assertEqual(len(nextup),3)
  self.assertFalse(first&nextup)
  self.assertEqual(self.d.slots['S001']['wave'],2)
 def test_decline_entire_wave_starts_next(self):
  wave=list(self.d.offers.values())
  for o in wave:
   self.d.respond(o['id'],'decline',o['patient_id'])
  self.assertEqual(len([o for o in self.d.offers.values() if o['state']=='offered']),3)
 def test_cannot_accept_expired(self):
  first=next(iter(self.d.offers.values()))
  self.d.advance('S001',20)
  with self.assertRaises(ValueError):self.d.respond(first['id'],'accept',first['patient_id'])
 def test_accept_stops_all_waves(self):
  first=next(iter(self.d.offers.values()))
  self.d.respond(first['id'],'accept',first['patient_id'])
  self.assertFalse(any(o['state']=='offered' for o in self.d.offers.values()))
  self.d.confirm('S001')
  self.assertEqual(self.d.slots['S001']['status'],'confirmed')
if __name__=='__main__': unittest.main()
