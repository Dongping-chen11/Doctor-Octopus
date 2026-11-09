import csv
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from data_adapter import DatasetError, load_csv
from engine import eligibility, load_rows, match

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.patient=dict(load_rows('patients.csv')[0]); self.slot=dict(load_rows('slots.csv')[0])
    def write(self, rows):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        p=Path(folder.name)/'test.csv'
        with p.open('w',newline='',encoding='utf-8') as f:
            writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
        return p
    def test_existing_schema_loads(self):
        self.assertEqual(len(load_rows('patients.csv')),500)
    def test_alias_fields_and_yes_no(self):
        p=dict(self.patient)
        p['requested_service']=p.pop('service_type');p['requested_duration_min']=p.pop('required_duration_min')
        p['estimated_travel_minutes']=p.pop('travel_min');p['opt_in_short_notice_offers']='Yes';p.pop('opt_in')
        p['active_earlier_appointment_request']='Yes';p.pop('active_request')
        row=load_csv(self.write([p]),'patient')[0]
        self.assertEqual(row['service_type'],'physiotherapy')
        self.assertEqual(row['opt_in'],'True')
        self.assertEqual(row['travel_min'],'20')
    def test_duplicate_patient_ids_rejected(self):
        with self.assertRaisesRegex(DatasetError,'duplicate'):load_csv(self.write([self.patient,self.patient]),'patient')
    def test_missing_service_fails_loudly(self):
        p=dict(self.patient);p.pop('service_type')
        with self.assertRaisesRegex(DatasetError,'service_type'):load_csv(self.write([p]),'patient')
    def test_bad_timestamp_fails_loudly(self):
        p=dict(self.patient,available_start='tomorrow')
        with self.assertRaisesRegex(DatasetError,'YYYY-MM-DD'):load_csv(self.write([p]),'patient')
    def test_max_travel_limit_excludes(self):
        p=dict(self.patient,max_travel_minutes='10')
        self.assertIn('Travel exceeds patient maximum',eligibility(p,self.slot))
    def test_notice_excludes(self):
        p=dict(self.patient,minimum_notice_minutes='180')
        self.assertIn('Insufficient minimum notice',eligibility(p,self.slot))
    def test_accessibility_requires_confirmation(self):
        p=dict(self.patient,accessibility_required='True')
        self.assertIn('Accessibility not confirmed for this opening',eligibility(p,self.slot))
        self.assertNotIn('Accessibility not confirmed for this opening',eligibility(p,dict(self.slot,accessible='True')))
    def test_reset_time_excludes_bad_window(self):
        self.assertIn('Insufficient room reset time',eligibility(self.patient,dict(self.slot,reset_minutes='10')))
    def test_unknown_columns_preserved(self):
        row=load_csv(self.write([dict(self.patient,transport_mode='walk')]),'patient')[0]
        self.assertEqual(row['transport_mode'],'walk')
    def test_legacy_matching_unchanged(self):
        data=match(self.slot,load_rows('patients.csv'))
        self.assertGreaterEqual(len(data['eligible']),5)

if __name__=='__main__':unittest.main()
