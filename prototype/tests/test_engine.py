import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import eligibility,load_rows,match
from server import Demo

class MatchingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.people=load_rows('patients.csv');cls.slots=load_rows('slots.csv')
    def test_five_hundred_synthetic_patients(self): self.assertEqual(len(self.people),500)
    def test_all_openings_return_500_decisions(self):
        for slot in self.slots:
            x=match(slot,self.people)
            self.assertEqual(len(x['eligible'])+len(x['excluded']),500)
    def test_wrong_service_excluded(self):
        p=dict(self.people[0],service_type='not_physio')
        self.assertIn('Service mismatch',eligibility(p,self.slots[0]))
    def test_opt_out_excluded(self):
        p=dict(self.people[0],opt_in='False')
        self.assertIn('No consent for appointment offers',eligibility(p,self.slots[0]))
    def test_ranked_descending(self):
        scores=[p['score'] for p in match(self.slots[0],self.people)['eligible']]
        self.assertEqual(scores,sorted(scores,reverse=True))
    def test_only_one_offer_can_win(self):
        d=Demo();d.cancel('S001');d.send('S001');created=list(d.offers.values());self.assertGreaterEqual(len(created),2)
        first,second=created[:2]
        d.respond(first['id'],'accept',first['patient_id'])
        with self.assertRaises(ValueError):d.respond(second['id'],'accept',second['patient_id'])
        self.assertEqual(d.slots['S001']['winner'],first['patient_id'])
        self.assertEqual(d.slots['S001']['status'],'held')
        d.confirm('S001');self.assertEqual(d.slots['S001']['status'],'confirmed')

if __name__=='__main__':unittest.main()
