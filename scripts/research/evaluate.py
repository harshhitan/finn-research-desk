"""Capture bounded, source-level retrieval evidence on the VM; never calls a model.

This is a review manifest, not an assertion that a passage answers the question.
Inspect the returned excerpts and original pages before approving answer quality.
"""
import argparse
import json
from pathlib import Path
import time

from worker import Worker, SITE, VERSION


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,default=Path('/home/azureuser/finn-personal/config.json'))
    parser.add_argument('--state',type=Path,default=Path('/var/lib/finn-research'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--ticker',action='append',help='Review only these case tickers; repeat to select several')
    args=parser.parse_args()
    if args.config.stat().st_mode & 0o077:
        raise ValueError('Configuration must have owner-only permissions')
    instance=Worker(json.loads(args.config.read_text()),args.state)
    cases=json.loads(Path(__file__).with_name('evaluation-cases.json').read_text())
    if args.ticker:
        selected={ticker.strip().upper() for ticker in args.ticker}
        unknown=selected-{case['ticker'] for case in cases}
        if unknown:parser.error('No review cases for: '+', '.join(sorted(unknown)))
        cases=[case for case in cases if case['ticker'] in selected]
    report={'site':SITE,'workerVersion':VERSION,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'modelInvoked':False,'cases':[],'coverage':{}}
    for index,case in enumerate(cases):
        start=time.monotonic()
        result=instance.api('evidence/check',{'ticker':case['ticker'],'query':case['question'],'filters':case.get('filters',{})})
        coverage=result['coverage']
        report['coverage'][case['ticker']]={'status':coverage['company']['status'],'counts':coverage['counts'],'documents':[{'id':d['id'],'type':d['type'],'period':d['period'],'version':d['active_version'],'status':d['status'],'sourceUrl':d['source_url'],'pages':d.get('page_count'),'readablePages':d.get('readable_pages')} for d in coverage['documents']]}
        passages=result['passages']
        violations=[]
        if case.get('expectEmpty') and passages:
            violations.append('Unexpected evidence for missing period')
        for p in passages:
            if p['ticker']!=case['ticker']:
                violations.append('Cross-company evidence')
            if case.get('filters',{}).get('period') and case['filters']['period'] not in p['period']:
                violations.append('Wrong reporting period')
            if case.get('filters',{}).get('types') and p['type'] not in case['filters']['types']:
                violations.append('Wrong source type')
        report['cases'].append({**case,'elapsedSeconds':round(time.monotonic()-start,3),'violations':violations,'passages':[{'id':p['id'],'documentId':p['document_id'],'version':p['version_id'],'period':p['period'],'type':p['type'],'page':p['page'],'heading':p['heading'],'sourceUrl':p['source_url'],'excerpt':p['text'][:800],'text':p['text']} for p in passages]})
        print(json.dumps({'case':index+1,'ticker':case['ticker'],'passages':len(passages),'violations':violations}),flush=True)
    args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False))
    instance.cache.close()
    if any(case['violations'] for case in report['cases']):
        raise SystemExit(1)


if __name__=='__main__':
    main()
