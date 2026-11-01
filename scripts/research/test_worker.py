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
    def test_validated_annual_format_is_reused_without_hiding_a_new_year(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'0'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path));checked=[]
            old='https://issuer.test/annual-report-2026.pdf';new='https://issuer.test/annual-report-2027.pdf';alternate='https://issuer.test/alternate-annual-report-2026.pdf'
            candidates=[{'url':u,'title':'Annual report','type':'annual_report','period':p} for u,p in [(alternate,'FY2026'),(new,'FY2027')]]
            instance.directory_lookup=lambda:False;instance.progress=lambda *args:None;instance.api=lambda *args:{}
            def process(job,document,seen):
                checked.append(document['url']);return {'url':document['url'],'period':document['period']}
            instance.process_document=process
            job={'id':'job','lease':'lease','company':{'ticker':'TEST','sources':[]},'documents':[{'source_url':old,'title':'Annual report','type':'annual_report','period':'FY2026','active_version':'version','status':'ready'}]}
            with patch.object(worker,'discover',return_value=(candidates,[])):instance.prepare(job)
            self.assertEqual(checked,[new,old]);instance.cache.close()

    def test_browser_verification_page_is_not_silent_empty_discovery(self):
        class Response(io.BytesIO):url='https://issuer.test/ir'
        with patch.object(worker,'source_open',return_value=Response(b'<html><title>Radware Captcha Page</title></html>')):
            with self.assertRaisesRegex(worker.ResearchError,'browser verification'):
                worker.html_links('https://issuer.test/ir')
        fetched=[]
        def pages(url):
            fetched.append(url)
            if url=='https://issuer.test/ir':raise worker.ResearchError('Primary source requires browser verification')
            return []
        with patch.object(worker,'html_links',side_effect=pages):
            _,diagnostics=worker.discover({'ticker':'TEST','sources':['https://issuer.test/ir','https://issuer.test/archive']})
        self.assertNotIn('https://issuer.test/archive',fetched);self.assertEqual(len(diagnostics),1)

    def test_table_rows_distinguish_synopses_notices_and_transcripts(self):
        parser=worker.Links('https://issuer.test/investors/conference-call')
        parser.feed('<table><tr><td>Presentation/Key Performance Highlights</td><td><a href="/file.pdf">Q1</a></td></tr><tr><td>Intimation of conference call</td><td><a href="/notice.pdf">Q2</a></td></tr><tr><td>Transcript</td><td><a href="/FinalTransctiptQ2FY26.pdf">Q2</a></td></tr></table>')
        kinds=[worker.document_kind(url,label,context+' '+parser.base) for url,label,context in parser.links]
        self.assertEqual(kinds,[None,None,'earnings_call'])
        self.assertIsNone(worker.document_kind('https://issuer.test/OFS_Q1_FY27.pdf','Q1','conference-call'))
        annual=worker.Links('https://issuer.test/ir');annual.feed('<h2>Annual reports</h2><table><tr><td><a href="/filing-uuid.pdf">2026</a></td></tr></table>')
        self.assertEqual(worker.document_kind(*annual.links[0]),'annual_report','Table context must preserve the enclosing report section')

    def test_financial_year_selector_uses_two_observed_same_page_targets(self):
        parser=worker.Links('https://issuer.test/investors/conference-call?language=en')
        parser.feed('<select name="field_financial_year_target_id"><option value="8">2024-25</option><option value="10">2025-26</option><option value="27" selected>2026-27</option><option value="All">Any</option></select>')
        self.assertEqual([url for url,_,_ in parser.links],['https://issuer.test/investors/conference-call?language=en&field_financial_year_target_id=10','https://issuer.test/investors/conference-call?language=en&field_financial_year_target_id=8'])
        self.assertEqual(worker.document_kind('https://issuer.test/FinalTransctiptQ2FY26.pdf','Q2','https://issuer.test/investors/conference-call'),'earnings_call')

    def test_neighbouring_table_year_does_not_overwrite_filename_period(self):
        old={'url':'https://issuer.test/ntpcq3fy18concalltranscriptfinal.pdf','title':'NTPC','period':'Q1 2025-26','type':'earnings_call'}
        newer={'url':'https://issuer.test/Earning-Call-Transcript_04022026_0.pdf','title':'Quarterly transcript','period':'Q1 2016-17','type':'earnings_call'}
        self.assertEqual(worker.document_period(old['url'],'Download','Q1 2025-26'),'Q3 2018')
        self.assertEqual(worker.document_period('https://issuer.test/no-date.pdf','Download','Q1 2025-26'),'Period unverified')
        self.assertGreater(worker.discovery_score(newer),worker.discovery_score(old))

    def test_compact_filename_dates_are_calendar_checked(self):
        self.assertEqual(worker.date_hint('Transcript_04022026_0.pdf'),2026*12+2)
        self.assertEqual(worker.date_hint('Concall25012025.pdf'),2025*12+1)
        self.assertEqual(worker.date_hint('Transcript_20260524.pdf'),2026*12+5)
        self.assertEqual(worker.date_hint('Transcript_31022026.pdf'),0)

    def test_discovery_continues_after_an_old_archive_fills_the_count(self):
        root='https://issuer.test/ir';current='https://issuer.test/investors/conference-call'
        links=[(f'https://issuer.test/annual-report-{y}.pdf','Annual report','') for y in [2026,2025]]+[(f'https://issuer.test/transcriptq{q}fy{y}.pdf','Download','Q1 2025-26') for y in [18,19] for q in [1,2,3]]+[(current,'Conference calls','')]
        def pages(url):
            if url==root:return links
            if url==current:return [('https://issuer.test/earnings-call-q2fy27.pdf','Q2 FY27','')]
            return []
        with patch.object(worker,'html_links',side_effect=pages):
            docs,_=worker.discover({'ticker':'TEST','sources':[root]})
        calls=[d for d in docs if d['type']=='earnings_call']
        self.assertEqual(calls[0]['period'],'Q2 2027');self.assertIn('q2fy27',calls[0]['url'])

    def test_discovery_checkpoint_is_serial_and_renews_the_lease(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'1'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path));events=[]
            instance.progress=lambda *args:events.append('progress');instance.answer_waiting_question=lambda:events.append('answer')
            with patch.object(worker.time,'monotonic',side_effect=[100,101]):
                instance.question_checkpoint({},'Discovering',{});instance.question_checkpoint({},'Discovering',{})
            self.assertEqual(events,['progress','answer','progress','progress']);instance.cache.close()

    def test_refresh_rechecks_active_calls_after_target_is_reached(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'0'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path))
            candidates=[{'url':'https://issuer.test/call'+str(i)+'.pdf','title':'Quarterly call','type':'earnings_call'} for i in range(6)]
            stale='https://issuer.test/ai-day.pdf';checked=[];calls=[]
            periods=['Q3 FY2025','Q4 FY2025','Q1 FY2026','Q2 FY2026','Q3 FY2026','Q4 FY2026']
            def process(job,document,seen):
                checked.append(document['url'])
                if document['url']==stale:raise worker.IneligibleDocument('Investor AI Day is not a quarterly call',document,'a'*64)
                return {'url':document['url'],'period':periods[len(checked)-1]}
            instance.process_document=process;instance.directory_lookup=lambda:False;instance.progress=lambda *args:None
            instance.api=lambda action,body:calls.append((action,body)) or {}
            job={'id':'job','lease':'lease','company':{'ticker':'RELIANCE','sources':[]},'documents':[{'source_url':stale,'title':'Old AI Day transcript','type':'earnings_call','period':'Period unverified','active_version':'version'}]}
            with patch.object(worker,'discover',return_value=(candidates,[])):
                instance.prepare(job)
            self.assertEqual(checked[-1],stale);self.assertEqual(calls[-1][0],'finish')
            self.assertEqual(calls[-1][1]['exclusions'][0]['url'],stale)
            instance.cache.close()

    def test_staged_index_resumes_and_questions_run_only_after_conversion(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'1'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path))
            digest='a'*64;url='https://issuer.test/report.pdf';events=[];calls=[]
            (Path(path)/'cache'/(digest+'.pdf')).write_bytes(b'%PDF fixture')
            instance.cache.execute('INSERT INTO files VALUES(?,?,?)',(url,digest,time.time()));instance.cache.commit()
            def api(action,body):
                calls.append((action,body))
                if action=='document/known':return {'known':False}
                if action=='document/start':return {'reused':False,'versionId':'version','nextOrdinal':25}
                return {}
            def pages(*args):
                events.append('extracting')
                yield 1,1,'Reliance Industries Annual Report 2025-26. Business operations and reported financial results.'
                events.append('conversion_finished')
            instance.api=api;instance.upload=lambda *args:None
            instance.progress=lambda *args:events.append('progress')
            instance.answer_waiting_question=lambda:events.append('answer')
            chunks=[{'page':1,'heading':'Financial results','text':'The company reports its operating business and financial results.'} for _ in range(45)]
            with patch.object(worker,'iter_pages',side_effect=pages),patch.object(worker,'page_chunks',return_value=chunks):
                instance.process_document({'id':'job','lease':'lease','ticker':'RELIANCE','company':{'name':'Reliance Industries'}},{'url':url,'title':'Annual report','type':'annual_report'})
            uploaded=[body for action,body in calls if action=='document/chunks']
            self.assertEqual([c['ordinal'] for batch in uploaded for c in batch['chunks']],list(range(25,45)))
            self.assertLess(events.index('conversion_finished'),events.index('answer'))
            self.assertEqual(events[events.index('answer')+1],'progress','Renew the preparation lease after inference')
            self.assertEqual(calls[-1][0],'document/finish');self.assertEqual(calls[-1][1]['chunkCount'],45)
            instance.cache.close()

    def test_rejected_answer_diagnostic_excludes_credentials_and_leases(self):
        with tempfile.TemporaryDirectory() as path,patch('sys.stdout',new_callable=io.StringIO):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'sensitive-test-service-token'},Path(path))
            instance.record_model_failure({'id':'question','lease':'sensitive-test-lease','input':{'passages':[]}},'transport',RuntimeError('private provider body'),None)
            diagnostic=Path(path)/'last-model-failure.json';raw=diagnostic.read_text()
            self.assertNotIn('sensitive-test',raw);self.assertNotIn('private provider body',raw);self.assertEqual(diagnostic.stat().st_mode&0o077,0);instance.cache.close()

    def test_discovery_cache_depends_on_identity_not_progress(self):
        a={'ticker':'TCS','sources':['https://issuer.test/ir','https://issuer.test/reports'],'status':'preparing','updated_at':'first'}
        b={**a,'sources':list(reversed(a['sources'])),'status':'ready','updated_at':'later'}
        self.assertEqual(worker.discovery_cache_key(a),worker.discovery_cache_key(b))
        self.assertNotEqual(worker.discovery_cache_key(a),worker.discovery_cache_key({**a,'sources':['https://issuer.test/new-ir']}))
        self.assertNotEqual(worker.discovery_cache_key(a),worker.discovery_cache_key({**a,'ticker':'INFY'}))

    def test_model_failure_does_not_abort_document_work(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'1'}),patch.object(worker,'available_memory',return_value=300),patch('sys.stdout',new_callable=io.StringIO) as log:
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path))
            calls=[]
            def api(action,body):
                calls.append(action)
                return {'question':{'id':'q','lease':'l'}} if action=='question/claim' else {}
            instance.api=api;instance.model_ready=lambda:True
            instance.answer=lambda q:(_ for _ in ()).throw(RuntimeError('private provider body must not enter logs'))
            self.assertTrue(instance.answer_waiting_question());self.assertEqual(calls,['question/claim','question/failed'])
            self.assertNotIn('private provider body',log.getvalue());instance.cache.close()

    def test_known_call_reuses_eligibility_only_for_the_same_hash_and_policy(self):
        with tempfile.TemporaryDirectory() as path,patch.dict(worker.os.environ,{'FINN_RESEARCH_MODEL_ENABLED':'0'}):
            instance=worker.Worker({'url':worker.SITE,'serviceToken':'test-only-token'},Path(path))
            digest='a'*64;url='https://issuer.test/call.pdf'
            (Path(path)/'cache'/(digest+'.pdf')).write_bytes(b'%PDF fixture')
            instance.cache.execute('INSERT INTO files VALUES(?,?,?)',(url,digest,time.time()))
            instance.cache.execute('INSERT INTO call_validation VALUES(?,?,1,?,?)',(digest,worker.CALL_POLICY,'Q1 FY2027',''));instance.cache.commit()
            actions=[]
            def api(action,body):
                actions.append((action,body))
                return {'known':True,'document':{'page_count':3,'period':'Period unverified','version_id':'version','active_version':'version'}} if action=='document/known' else {}
            instance.api=api
            with patch.object(worker,'iter_pages') as extraction:
                result=instance.process_document({'id':'job','lease':'lease'},{'url':url,'title':'Call','type':'earnings_call'})
                self.assertTrue(result['reused']);self.assertEqual(result['period'],'Q1 FY2027');extraction.assert_not_called()
                self.assertEqual(actions[-1][0],'document/verified-period');self.assertEqual(actions[-1][1]['period'],'Q1 FY2027')
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
        self.assertEqual(worker.verified_period('earnings_call','Transcript of the Earnings Call for the quarter and financial year ended 31st March, 2026'),'Q4 FY2026')
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
