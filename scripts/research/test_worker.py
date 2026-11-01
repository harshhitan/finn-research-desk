import io
import json
from pathlib import Path
import socket
import tempfile
import time
import unittest
from unittest.mock import patch

import worker


class WorkerTests(unittest.TestCase):
    def test_known_call_reuses_eligibility_only_for_the_same_hash_and_policy(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'0'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path))
            digest='a'*64;url='https://issuer.test/call.pdf'
            (Path(path)/'cache'/(digest+'.pdf')).write_bytes(b'%PDF fixture')
            instance.cache.execute('INSERT INTO files VALUES(?,?,?)',(url,digest,time.time()))
            instance.cache.execute('INSERT INTO call_validation VALUES(?,?,1,?,?)',(digest,worker.CALL_POLICY,'Q1 FY2027',''));instance.cache.commit()
            instance.api=lambda action,body:{'known':True,'document':{'page_count':3}} if action=='document/known' else {}
            with patch.object(worker,'iter_pages') as extraction:
                result=instance.process_document({'id':'job','lease':'lease'},{'url':url,'title':'Call','type':'earnings_call'})
                self.assertTrue(result['reused']);self.assertEqual(result['period'],'Q1 FY2027');extraction.assert_not_called()
            instance.cache.execute('UPDATE call_validation SET eligible=0,reason=?',('A recording notice',));instance.cache.commit()
            with patch.object(worker,'iter_pages') as extraction:
                with self.assertRaises(worker.IneligibleDocument):
                    instance.process_document({'id':'job','lease':'lease'},{'url':url,'title':'Call','type':'earnings_call'})
                extraction.assert_not_called()
            instance.cache.close()

    def test_recording_notices_are_not_transcripts(self):
        notice='Please find the earnings call transcript at our website. Audio recording is available. '*30
        self.assertFalse(worker.is_call_transcript(notice,1))
        self.assertFalse(worker.is_call_transcript(notice,3))
        self.assertTrue(worker.is_call_transcript('Moderator: Welcome to the quarterly earnings call. '+('Company reports its operating performance and revenue. '*40),3))
        self.assertTrue(worker.is_call_transcript('Q2 FY2027 earnings call\nSalil Parekh: Welcome.\nSandeep Mahindroo: Thank you.\n'+('Reported performance and customer demand. '*50),3))
        self.assertFalse(worker.is_call_transcript('Investor AI Day\nModerator: Welcome. '+('Discussion of technology strategies and products. '*50),12))

    def test_period_is_read_from_document_not_neighbouring_link(self):
        self.assertEqual(worker.verified_period('annual_report','Reliance Industries Integrated Annual Report 2025-26 Contents 2024-25'),'FY2026')
        self.assertEqual(worker.verified_period('annual_report','Annual Report 2026'),'FY2026')
        self.assertEqual(worker.verified_period('annual_report','A report without a cover date'),'Period unverified')
        self.assertEqual(worker.verified_period('earnings_call','TCS Q2 FY2027 earnings conference call transcript'),'Q2 FY2027')
        self.assertEqual(worker.verified_period('earnings_call','Infosys Q4 2025-26 conference call'),'Q4 FY2026')
        self.assertEqual(worker.verified_period('earnings_call','RIL Q1 FY2026 - 2027 Media & Analyst Call Transcript'),'Q1 FY2027')
        self.assertEqual(worker.verified_period('earnings_call','Transcript of the Earnings Call for the quarter ended 30th June, 2026'),'Q1 FY2027')
        self.assertEqual(worker.verified_period('earnings_call','Company quarterly-results/2026-2027/q2.html'),'Q2 FY2027')
        self.assertEqual(worker.document_period('https://issuer.test/infosys-ar-26.pdf','','Reports 2020'),'2026')

    def test_document_types_exclude_presentations_and_summaries(self):
        self.assertEqual(worker.document_kind('https://issuer.test/call.pdf','Transcript','Concall'), 'earnings_call')
        self.assertEqual(worker.document_kind('https://issuer.test/annual-report-2026.pdf','Annual report'), 'annual_report')
        self.assertIsNone(worker.document_kind('https://issuer.test/Fact%20Sheet.pdf','PPT','Concall Transcript'))
        self.assertIsNone(worker.document_kind('https://issuer.test/presentation.pdf','Presentation','Transcript'))
        self.assertIsNone(worker.document_kind('https://issuer.test/results.pdf','Results','Transcript'))
        self.assertIsNone(worker.document_kind('https://issuer.test/news.html','Transcript'))

    def test_link_extraction_preserves_section_and_encodes_spaces(self):
        parser=worker.Links('https://issuer.test/investors/')
        parser.feed('<h2>Annual reports</h2><a href="/annual report.pdf">Download (2MB)</a><h2>Transcripts</h2><a href="/call.pdf">Download</a>')
        self.assertEqual(parser.links[0][0],'https://issuer.test/annual%20report.pdf')
        self.assertIn('Annual reports',parser.links[0][2])
        self.assertIn('Transcripts',parser.links[1][2])

    def test_private_urls_and_credentials_are_rejected(self):
        for url in ('file:///etc/passwd','http://issuer.test/a.pdf','https://user:pw@issuer.test/a.pdf','https://issuer.test:8443/a.pdf'):
            with self.subTest(url=url), self.assertRaises(worker.ResearchError):
                worker.public_url(url)
        for address in ('127.0.0.1','169.254.169.254','10.0.0.1','::1'):
            with self.subTest(address=address), patch.object(socket,'getaddrinfo',return_value=[(socket.AF_INET,socket.SOCK_STREAM,6,'',(address,443))]), self.assertRaises(worker.ResearchError):
                worker.public_url('https://issuer.test/doc.pdf')

    def test_chunks_preserve_page_and_table_text(self):
        text='Annual report\nRevenue    100    90\nCash flow  120   110\n'+'Business operations and cash conversion.\n'*180
        chunks=list(worker.page_chunks(15,text))
        self.assertGreater(len(chunks),1)
        self.assertTrue(all(c['page']==15 and len(c['text'])<=2800 for c in chunks))
        self.assertIn('Revenue    100    90',chunks[0]['text'])
        self.assertEqual(list(worker.page_chunks(1,'   ')),[])

    def test_sorting_respects_fiscal_and_call_dates(self):
        newer={'url':'https://issuer.test/2026-27/q2/transcript.pdf','title':'Q2 2026-27 transcript'}
        older={'url':'https://issuer.test/2025-26/q4/transcript.pdf','title':'Q4 2025-26 transcript'}
        self.assertGreater(worker.discovery_score(newer),worker.discovery_score(older))
        self.assertGreater(worker.date_hint('Oct 2026 Transcript'),worker.date_hint('Jul 2026 Transcript'))

    def test_pdf_size_limit_precedes_download(self):
        class Response(io.BytesIO):
            headers={'Content-Length':str(worker.MAX_PDF+1)}
        with tempfile.TemporaryDirectory() as path,patch.object(worker,'source_open',return_value=Response(b'%PDF-1.7')):
            with self.assertRaisesRegex(worker.ResearchError,'64 MiB'):
                worker.download('https://issuer.test/report.pdf',Path(path))

    def test_memory_guard_prevents_extraction(self):
        def command(args,path,timeout=55):
            path.write_text('Pages: 12\n')
        with tempfile.TemporaryDirectory() as path,patch.object(worker,'command',side_effect=command),patch.object(worker,'available_memory',return_value=100):
            with self.assertRaisesRegex(worker.ResearchError,'memory'):
                list(worker.iter_pages(Path(path)/'file.pdf',Path(path)))

    def test_disabled_model_does_not_even_launch_codex(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'0'}),patch.object(worker.subprocess,'run') as process:
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-service-token'},Path(path))
            self.assertFalse(instance.model_ready())
            process.assert_not_called()
            instance.cache.close()


if __name__=='__main__':
    unittest.main()
