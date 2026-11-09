import unittest
from server import Demo

class WorkflowTests(unittest.TestCase):
    def setUp(self): self.d=Demo()
    def test_initially_booked(self):self.assertEqual(self.d.slots['S001']['status'],'booked')
    def test_cancel_creates_opening(self):
        self.d.cancel('S001');self.assertEqual(self.d.slots['S001']['status'],'open');self.assertTrue(self.d.candidates('S001')['eligible'])
    def test_cannot_double_cancel(self):
        self.d.cancel('S001')
        with self.assertRaises(ValueError):self.d.cancel('S001')
    def test_successful_booking(self):
        self.d.cancel('S001');self.d.send('S001');offer=next(iter(self.d.offers.values()));self.d.respond(offer['id'],'accept',offer['patient_id']);self.assertEqual(self.d.slots['S001']['status'],'held');self.d.confirm('S001');self.assertEqual(self.d.slots['S001']['status'],'confirmed')
    def test_only_one_winner(self):
        self.d.cancel('S001');self.d.send('S001');offers=list(self.d.offers.values());self.d.respond(offers[0]['id'],'accept',offers[0]['patient_id'])
        with self.assertRaises(ValueError):self.d.respond(offers[1]['id'],'accept',offers[1]['patient_id'])
    def test_reset(self):
        self.d.cancel('S001');self.d.reset();self.assertEqual(self.d.slots['S001']['status'],'booked')
if __name__=='__main__':unittest.main()
