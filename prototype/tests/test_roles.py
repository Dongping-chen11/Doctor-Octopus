import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Demo, PATIENT_BY_ID


class RoleAndPrivacyContractTests(unittest.TestCase):
    def setUp(self):
        self.demo = Demo()

    def test_patient_gets_only_own_offers_without_rank(self):
        self.demo.cancel('S001')
        self.demo.send('S001')
        items = list(self.demo.offers.values())
        self.assertEqual(len(items), 3)
        first = items[0]
        other = items[1]
        patient_view = self.demo.patient_state(first['patient_id'])
        raw = str(patient_view).lower()
        self.assertEqual(len(patient_view['offers']), 1)
        self.assertNotIn(other['patient_id'], raw)
        self.assertNotIn('score', raw)
        self.assertNotIn('eligible', raw)
        self.assertNotIn('excluded', raw)
        self.assertNotIn('events', raw)
        self.assertNotIn('winner', raw)
        self.assertNotIn('referral_verified', raw)

    def test_unoffered_patient_sees_no_other_patient_offer(self):
        self.demo.cancel('S001')
        self.demo.send('S001')
        offered = {x['patient_id'] for x in self.demo.offers.values()}
        another = next(i for i in PATIENT_BY_ID if i not in offered)
        view = self.demo.patient_state(another)
        self.assertEqual(view['offers'], [])
        self.assertEqual(view['appointments'], [])

    def test_other_persona_cannot_accept_someone_elses_offer(self):
        self.demo.cancel('S001')
        self.demo.send('S001')
        offer = next(iter(self.demo.offers.values()))
        other = next(i for i in PATIENT_BY_ID if i != offer['patient_id'])
        with self.assertRaises(ValueError):
            self.demo.respond(offer['id'], 'accept', other)
        self.assertEqual(self.demo.slots['S001']['status'], 'offering')

    def test_patient_appointment_appears_after_acceptance_and_confirmation(self):
        self.demo.cancel('S001')
        self.demo.send('S001')
        offer = next(iter(self.demo.offers.values()))
        pid = offer['patient_id']
        self.demo.respond(offer['id'], 'accept', pid)
        view = self.demo.patient_state(pid)
        self.assertEqual(view['appointments'][0]['status'], 'held')
        self.demo.confirm('S001')
        self.assertEqual(self.demo.patient_state(pid)['appointments'][0]['status'], 'confirmed')
        self.assertEqual(self.demo.clinic_state()['slots'][0]['status'], 'confirmed')

    def test_reset_erases_offers(self):
        self.demo.cancel('S001')
        self.demo.send('S001')
        self.demo.reset()
        self.assertEqual(self.demo.offers, {})
        self.assertEqual(self.demo.slots['S001']['status'], 'booked')

if __name__ == '__main__':
    unittest.main()
