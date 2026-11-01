"""FINN's low-memory document/research worker. Internal tools only; no MCP.

Public documents are converted in page batches. Model calls are opt-in, separate
from ingestion, and require both an explicit setting and a current Codex login.
"""
import argparse
import contextlib
import csv
import hashlib
import http.client
from html.parser import HTMLParser
from html import unescape
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import resource
import shutil
import socket
import sqlite3
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = 'https://finn-reliance-research-desk.cozyjay15.chatgpt.site'
VERSION = 'research-1'
PARSER = 'poppler-layout-pages-v1'
MAX_PDF = 64 * 1024 * 1024
MAX_HTML = 3 * 1024 * 1024
USER_AGENT = 'Mozilla/5.0 (compatible; FINNResearch/1.0; primary-document research)'


class ResearchError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def public_url(value):
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.port:
        raise ResearchError('Only public HTTPS document sources are accepted')
    if len(value) > 3000:
        raise ResearchError('Source URL is too long')
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ResearchError('Private network destinations are not accepted')
    except socket.gaierror:
        raise ResearchError('Source hostname could not be resolved') from None
    return value


def source_open(url, timeout=30):
    for _ in range(5):
        public_url(url)
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': '*/*'})
        try:
            return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            code, location = error.code, error.headers.get('Location')
            error.close()
            if code in (301, 302, 303, 307, 308) and location:
                url = urllib.parse.urljoin(url, location)
                continue
            raise ResearchError('Source HTTP ' + str(code)) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise ResearchError('Source connection failed') from None
    raise ResearchError('Source redirect limit exceeded')


class Links(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.links, self.current, self.context = base, [], None, ''
        self.section, self.heading_tag, self.heading_text = '', None, ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('h1','h2','h3','h4'):
            self.heading_tag, self.heading_text = tag, ''
        if tag == 'a' and attrs.get('href'):
            target = urllib.parse.urljoin(self.base, attrs['href'])
            target = urllib.parse.quote(target, safe=":/?#[]@!$&'()*+,;=%-._~")
            self.current = [target, '', self.section + ' ' + self.context[-180:]]
        elif any(attrs.get(key) for key in ('data-href','data-url','value')):
            target = next((attrs[key] for key in ('data-href','data-url','value') if attrs.get(key)), '')
            if '.pdf' in target.lower():
                self.links.append((urllib.parse.urljoin(self.base,target),attrs.get('title','') or attrs.get('aria-label',''),self.section))

    def handle_endtag(self, tag):
        if tag == self.heading_tag:
            self.section, self.heading_tag = self.heading_text.strip(), None
        if tag == 'a' and self.current:
            self.links.append(tuple(self.current))
            self.current = None

    def handle_data(self, data):
        value = re.sub(r'\s+', ' ', data).strip()
        if value:
            if self.heading_tag:
                self.heading_text += ' ' + value
            self.context = (self.context + ' ' + value)[-350:]
            if self.current:
                self.current[1] += ' ' + value


def html_links(url):
    with source_open(url, 20) as response:
        raw = response.read(MAX_HTML + 1)
        if len(raw) > MAX_HTML:
            raise ResearchError('Discovery page exceeds size limit')
        if raw.startswith(b'%PDF'):
            return [(response.url, '', '')]
        parser = Links(response.url)
        source = raw.decode('utf-8', 'replace')
        parser.feed(source)
        # Issuer pages also put download URLs in JSON/data attributes. These
        # links still pass primary-host, type and downloaded-document checks.
        for target in re.findall(r'(?:https?://|/)[^\s"<>]+?\.pdf(?:\?[^\s"<>]*)?', source.replace('\\/','/'), re.I):
            if len(target) < 3000:
                parser.links.append((urllib.parse.urljoin(response.url,unescape(target)), '', ''))
        return parser.links


def document_kind(url, label='', context=''):
    value = urllib.parse.unquote(url + ' ' + label).lower()
    if re.search(r'\.pdf(?:[?#&]|$)', url, re.I) is None:
        return None
    if re.search(r'\bppt\b|presentation|fact.?sheet|ai.?summary|annual.?general.?meeting|\bagm\b', value):
        return None
    if re.search(r'transcript|concall|conference.?call|earnings.?call', value):
        return 'earnings_call'
    if re.search(r'annual.?report|integrated.?report|integratedannual|\biar\b|/ar/|\bar[-_ ]?2[0-9]\b', value):
        return 'annual_report'
    # A generic "Download" link needs its surrounding source section.
    combined = context.lower()
    if label.strip() and not re.match(r'^(download|pdf|click here)(\s|\(|$)',label.strip(),re.I):
        return None
    if re.search(r'concall|transcript', combined):
        return 'earnings_call'
    if re.search(r'annual report|integrated report', combined):
        return 'annual_report'
    return None


def document_period(url, label='', context=''):
    value = urllib.parse.unquote(label + ' ' + url + ' ' + context)
    match = re.search(r'(20\d{2})\s*[-–/]\s*(?:20)?(\d{2})', value)
    year = (match.group(1) + '-' + match.group(2)) if match else None
    if not year:
        match = re.search(r'\b(?:FY\s*)?(20\d{2})\b', value, re.I)
        if match:
            year = match.group(1)
    quarter = re.search(r'\bQ([1-4])\b', value, re.I)
    return ((quarter.group(0).upper() + ' ') if quarter else '') + (year or 'Period unverified')


def date_hint(value):
    months = {'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12}
    found = list(re.finditer(r'\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:\d{1,2},?\s+)?(20\d{2})\b',urllib.parse.unquote(value),re.I))
    return int(found[-1].group(2))*12+months[found[-1].group(1)[:3].lower()] if found else 0


def discovery_score(document):
    value = urllib.parse.unquote(document['url'] + ' ' + document['title'] + ' ' + document.get('period',''))
    years = [int(y) for y in re.findall(r'20\d{2}', value)]
    quarter = re.search(r'\bq([1-4])', value, re.I)
    fiscal = re.search(r'(20\d{2})\s*[-/]\s*(?:20)?(\d{2})', value)
    ending = int('20' + fiscal.group(2)) if fiscal else max(years, default=2000)
    q = int(quarter.group(1)) if quarter else 4
    date = document.get('sortDate') or date_hint(value) or ((ending-(1 if q<4 else 0))*12+{1:6,2:9,3:12,4:3}[q])
    return (date, int(quarter.group(1)) if quarter else 0,
            0 if 'bseindia.com' in document['url'] else 1)


def discover(company, progress=lambda *_: None):
    ticker = company['ticker']
    roots = list(company.get('sources') or [])
    roots.append('https://www.screener.in/company/' + urllib.parse.quote(ticker, safe='') + '/consolidated/')
    documents, visited, diagnostics, queue = {}, set(), [], [(url, 0) for url in roots]
    issuer_hosts = {urllib.parse.urlsplit(url).hostname for url in roots if 'screener.in' not in url}
    while queue and len(visited) < 16:
        url, depth = queue.pop(0)
        url = urllib.parse.urldefrag(url)[0]
        if url in visited:
            continue
        visited.add(url)
        progress('Discovering primary documents', {'pagesChecked': len(visited), 'candidates': len(documents)})
        try:
            links = html_links(url)
        except ResearchError as error:
            diagnostics.append({'url': url, 'reason': str(error)})
            continue
        for href, label, surrounding in links:
            parsed = urllib.parse.urlsplit(href)
            if parsed.scheme != 'https' or not parsed.hostname:
                continue
            host = parsed.hostname.lower()
            from_directory = 'screener.in' in urllib.parse.urlsplit(url).hostname
            if from_directory and (re.search(r'company website|^website$', label.strip(), re.I) or (parsed.path in ('','/') and host.removeprefix('www.') in label.lower())):
                issuer_hosts.add(host)
                if depth < 2:
                    queue.append((href, depth + 1))
            allowed = host in issuer_hosts or any(host == d or host.endswith('.' + d) for d in ('nseindia.com', 'bseindia.com', 'ril.com', 'tcs.com', 'infosys.com', 'hul.co.in', 'larsentoubro.com', 'ntpc.co.in'))
            # A directory link itself is not research evidence. Only its linked
            # primary report/transcript can become an indexed document.
            kind = document_kind(href, label, surrounding)
            if kind and allowed:
                title = re.sub(r'\s+', ' ', label).strip()
                if not title or title.lower() in ('download', 'click here', 'pdf'):
                    title = urllib.parse.unquote(Path(parsed.path).name)
                document = {'url': urllib.parse.urldefrag(href)[0], 'title': (ticker + ' — ' + title)[:400],
                            'type': kind, 'period': document_period(href, label, surrounding), 'discoveredFrom': url}
                document['sortDate'] = date_hint(surrounding + ' ' + label) or date_hint(href)
                document['discoveryQuality'] = (3 if label.strip() else 0) + (2 if document['sortDate'] else 0) + (0 if 'unverified' in document['period'] else 1)
                previous = documents.get(document['url'])
                if not previous or document['discoveryQuality']>previous.get('discoveryQuality',0) or (document['discoveryQuality']==previous.get('discoveryQuality',0) and len(document['title'])>len(previous['title'])):
                    documents[document['url']] = document
            elif depth < 2 and allowed and host not in ('www.screener.in', 'screener.in'):
                description = urllib.parse.unquote(href + ' ' + label)
                if re.search(r'annual|financial|quarter|earning|transcript|concall|investor|report.*filing', description, re.I) and not re.search(r'\.(mp3|mp4|zip|xlsx|jpg|png)(?:[?#]|$)', href, re.I):
                    if not parsed.path.lower().endswith('.pdf'):
                        queue.append((href, depth + 1))
        have = list(documents.values())
        if sum(d['type'] == 'annual_report' for d in have) >= 2 and sum(d['type'] == 'earnings_call' for d in have) >= 6:
            break
    chosen = []
    for kind, limit in (('annual_report', 6), ('earnings_call', 12)):
        ranked = sorted((d for d in documents.values() if d['type'] == kind), key=discovery_score, reverse=True)
        chosen.extend(ranked[:limit])
    return chosen, diagnostics


def available_memory():
    try:
        value = Path('/proc/meminfo').read_text()
        return int(re.search(r'MemAvailable:\s+(\d+)', value).group(1)) // 1024
    except (OSError, AttributeError):
        return 0


def child_limits():
    limit = 160 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 * 1024, 4 * 1024 * 1024))


def command(args, output, timeout=55):
    with output.open('wb') as stream:
        try:
            result = subprocess.run(args, stdout=stream, stderr=subprocess.DEVNULL, timeout=timeout,
                                    preexec_fn=child_limits, env={**os.environ, 'OMP_THREAD_LIMIT': '1', 'OMP_NUM_THREADS': '1'})
        except subprocess.TimeoutExpired:
            raise ResearchError('Document extraction exceeded its time limit') from None
    if result.returncode:
        raise ResearchError('Document extraction exceeded its resource limit or failed')
    if output.stat().st_size > 4 * 1024 * 1024:
        raise ResearchError('Extracted page batch is too large')


def iter_pages(pdf, directory, progress=lambda *_: None):
    info = directory / 'info.txt'
    command(['pdfinfo', str(pdf)], info, 15)
    match = re.search(r'^Pages:\s+(\d+)', info.read_text(errors='replace'), re.M)
    if not match or not 1 <= int(match.group(1)) <= 2500:
        raise ResearchError('PDF page count is unavailable or exceeds the 2500-page limit')
    total, ocr_count = int(match.group(1)), 0
    for start in range(1, total + 1, 8):
        if available_memory() < 150:
            raise ResearchError('Document preparation deferred because available VM memory is low')
        end, output = min(start + 7, total), directory / 'pages.txt'
        command(['pdftotext', '-f', str(start), '-l', str(end), '-layout', '-enc', 'UTF-8', str(pdf), str(output)], directory / 'command.txt')
        if output.stat().st_size > 4 * 1024 * 1024:
            raise ResearchError('Extracted page batch is too large')
        pages = output.read_text(encoding='utf-8', errors='replace').split('\f')
        for offset, page in enumerate(pages[:end-start+1]):
            number = start + offset
            if len(page.strip()) < 40 and ocr_count < 8 and shutil.which('tesseract') and available_memory() > 220:
                prefix, ocr = directory / 'ocr-page', directory / 'ocr.txt'
                try:
                    command(['pdftoppm', '-f', str(number), '-l', str(number), '-singlefile', '-scale-to', '1400', '-png', str(pdf), str(prefix)], directory / 'render.txt')
                    command(['tesseract', str(prefix) + '.png', 'stdout', '-l', 'eng', '--psm', '3'], ocr)
                    candidate = ocr.read_text(errors='replace')
                    if len(candidate.strip()) > len(page.strip()):
                        page = candidate
                except ResearchError:
                    pass
                ocr_count += 1
                Path(str(prefix) + '.png').unlink(missing_ok=True)
            yield total, number, re.sub(r'[\x00-\x08\x0b\x0e-\x1f]', '', page)
        progress('Extracting page text', {'page': end, 'pages': total, 'ocrPagesAttempted': ocr_count})


def page_chunks(page, text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    heading = next((line for line in lines[:8] if 8 < len(line) < 150), '')[:300]
    # Keep table columns/newlines in stored evidence. Split only at line/word
    # boundaries and retain a small overlap for sentence continuity.
    start = 0
    while start < len(text):
        end = min(start + 2800, len(text))
        if end < len(text):
            split = text.rfind('\n', start + 1400, end)
            if split > start:
                end = split
        value = text[start:end].strip()
        if len(value) >= 40:
            yield {'page': page, 'heading': heading, 'text': value}
        if end >= len(text):
            break
        start = max(start + 1, end - 200)


def download(url, directory):
    target = directory / 'original.pdf'
    digest, count = hashlib.sha256(), 0
    with source_open(url) as response, target.open('wb') as output:
        if int(response.headers.get('Content-Length') or 0) > MAX_PDF:
            raise ResearchError('PDF exceeds the 64 MiB ingestion limit')
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            count += len(chunk)
            if count > MAX_PDF:
                raise ResearchError('PDF exceeds the 64 MiB ingestion limit')
            digest.update(chunk)
            output.write(chunk)
    with target.open('rb') as stream:
        if b'%PDF-' not in stream.read(1024):
            raise ResearchError('Source did not return a PDF document')
    return target, digest.hexdigest()


class Worker:
    def __init__(self, config, state):
        if config.get('url') != SITE or not isinstance(config.get('serviceToken'), str):
            raise ResearchError('Unexpected private Site configuration')
        self.config, self.state = config, state
        self.state.mkdir(parents=True, exist_ok=True)
        self.opener = urllib.request.build_opener(NoRedirect())
        self.last_progress = 0
        self.model_enabled = os.environ.get('FINN_RESEARCH_MODEL_ENABLED') == '1'
        self.cache = sqlite3.connect(str(self.state / 'cache.sqlite'))
        self.cache.execute('CREATE TABLE IF NOT EXISTS files(url TEXT PRIMARY KEY,hash TEXT NOT NULL,fetched_at REAL NOT NULL)')
        (self.state / 'cache').mkdir(exist_ok=True)

    def api(self, path, body):
        raw = json.dumps(body).encode()
        if len(raw) > 250000:
            raise ResearchError('Research upload batch exceeds the size limit')
        req = urllib.request.Request(SITE + '/api/research/worker/' + path, data=raw,
            headers={'Content-Type': 'application/json', 'OAI-Sites-Authorization': 'Bearer ' + self.config['serviceToken'], 'X-Finn-Job-Token': self.config['serviceToken']})
        try:
            with self.opener.open(req, timeout=60) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ResearchError('Research response exceeds size limit')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            code = error.code
            try:
                value = json.loads(error.read(4096)).get('error', '')
            except (ValueError, AttributeError):
                value = ''
            error.close()
            raise ResearchError('FINN research HTTP ' + str(code) + ': ' + str(value)[:300]) from None

    def upload(self, job, digest, path, extension):
        connection = http.client.HTTPSConnection(urllib.parse.urlsplit(SITE).hostname, timeout=90, context=ssl.create_default_context())
        try:
            with path.open('rb') as data:
                connection.request('PUT', '/api/research/worker/artifact/' + job['id'] + '/' + digest + '/' + extension,
                    body=data, headers={'Content-Length': str(path.stat().st_size), 'Content-Type': 'application/pdf' if extension == 'pdf' else 'application/x-ndjson',
                    'OAI-Sites-Authorization': 'Bearer ' + self.config['serviceToken'], 'X-Finn-Job-Token': self.config['serviceToken'], 'X-Finn-Job-Lease': job['lease']})
                response = connection.getresponse()
                raw = response.read(4096)
                if response.status != 200:
                    raise ResearchError('Document artifact upload failed: HTTP ' + str(response.status))
                return json.loads(raw)
        finally:
            connection.close()

    def model_ready(self):
        if not self.model_enabled:
            return False
        result = subprocess.run(['/home/azureuser/.local/bin/codex', 'login', 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
        return result.returncode == 0

    def heartbeat(self):
        return self.api('heartbeat', {'memoryAvailableMb': available_memory(), 'workerVersion': VERSION,
            'modelReady': self.model_ready(), 'modelEnabled': self.model_enabled,
            'lastChildPeakMb': round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024, 1)})

    def progress(self, job, stage, progress):
        self.api('progress', {'jobId': job['id'], 'lease': job['lease'], 'stage': stage, 'progress': progress})
        if time.monotonic() - self.last_progress > 45:
            self.heartbeat()
            self.last_progress = time.monotonic()

    def process_document(self, job, document):
        with tempfile.TemporaryDirectory(prefix='document-', dir=self.state) as temporary:
            directory = Path(temporary)
            self.progress(job, 'Downloading ' + document['type'], {'title': document['title']})
            cached = self.cache.execute('SELECT hash,fetched_at FROM files WHERE url=?', (document['url'],)).fetchone()
            cache_path = self.state / 'cache' / (cached[0] + '.pdf') if cached else None
            if cached and time.time() - cached[1] < 86400 and cache_path.is_file():
                pdf, digest = cache_path, cached[0]
            else:
                pdf, digest = download(document['url'], directory)
                cache_path = self.state / 'cache' / (digest + '.pdf')
                if not cache_path.exists():
                    shutil.copyfile(pdf, cache_path)
                self.cache.execute('INSERT INTO files(url,hash,fetched_at) VALUES(?,?,?) ON CONFLICT(url) DO UPDATE SET hash=excluded.hash,fetched_at=excluded.fetched_at', (document['url'], digest, time.time()))
                self.cache.commit()
                # A bounded file cache supplements durable R2 originals.
                cached_files = sorted((self.state / 'cache').glob('*.pdf'), key=lambda p:p.stat().st_mtime)
                total_bytes = sum(p.stat().st_size for p in cached_files)
                for old in cached_files:
                    if total_bytes <= 2 * 1024**3:
                        break
                    if old != cache_path:
                        total_bytes -= old.stat().st_size
                        old.unlink()
            known = self.api('document/known', {'jobId': job['id'], 'lease': job['lease'], 'hash': digest, 'parser': PARSER, 'type': document['type']})
            if known.get('known'):
                return {'url': document['url'], 'reused': True, 'pages': known['document']['page_count']}
            chunks_file, pages_file = directory / 'chunks.jsonl', directory / 'pages.jsonl'
            total, readable, count, identity_text = 0, 0, 0, ''
            with chunks_file.open('w', encoding='utf-8') as chunks, pages_file.open('w', encoding='utf-8') as pages:
                for total, page, value in iter_pages(pdf, directory, lambda s,p: self.progress(job,s,p)):
                    if len(identity_text) < 30000:
                        identity_text += ' ' + value[:30000-len(identity_text)]
                    if len(value.strip()) >= 40:
                        readable += 1
                    pages.write(json.dumps({'page': page, 'text': value}, ensure_ascii=False) + '\n')
                    for chunk in page_chunks(page, value):
                        chunks.write(json.dumps({**chunk, 'ordinal': count}, ensure_ascii=False) + '\n')
                        count += 1
            if not count:
                raise ResearchError('Document has no usable text after bounded extraction/OCR')
            names = [w for w in re.findall('[a-z]+', job['company']['name'].lower()) if len(w)>3 and w not in ('limited','india','company','industries')]
            normalised_identity = re.sub('[^a-z0-9]+',' ',identity_text.lower())
            short = job['ticker'].lower()
            if not ((len(short)>2 and re.search(r'\b'+re.escape(short)+r'\b',normalised_identity)) or (names and sum(w in normalised_identity for w in names)>=min(2,len(names)))):
                raise ResearchError('The extracted document does not establish the selected company identity')
            if document['type']=='earnings_call' and not re.search(r'transcript|moderator|operator|questions?\s*(?:and|&)\s*answers?',identity_text,re.I):
                raise ResearchError('Document content does not establish an earnings-call transcript')
            if document['type']=='annual_report' and not re.search(r'annual\s+report|integrated\s+(?:annual\s+)?report',identity_text,re.I):
                raise ResearchError('Document content does not establish an annual report')
            self.progress(job, 'Storing original and extracted evidence', {'pages': total, 'readablePages': readable, 'chunks': count})
            self.upload(job, digest, pdf, 'pdf')
            self.upload(job, digest, pages_file, 'jsonl')
            metadata = {**document, 'hash': digest, 'parser': PARSER, 'pages': total, 'readablePages': readable}
            prepared = self.api('document/start', {'jobId': job['id'], 'lease': job['lease'], 'document': metadata})
            if prepared.get('reused'):
                return {'url': document['url'], 'reused': True, 'pages': total}
            batch = []
            with chunks_file.open(encoding='utf-8') as stream:
                for line in stream:
                    batch.append(json.loads(line))
                    if len(batch) == 20:
                        self.api('document/chunks', {'jobId': job['id'], 'lease': job['lease'], 'versionId': prepared['versionId'], 'chunks': batch})
                        self.progress(job, 'Indexing page evidence', {'pages': total, 'chunksIndexed': batch[-1]['ordinal'] + 1, 'chunks': count})
                        batch = []
                if batch:
                    self.api('document/chunks', {'jobId': job['id'], 'lease': job['lease'], 'versionId': prepared['versionId'], 'chunks': batch})
            self.api('document/finish', {'jobId': job['id'], 'lease': job['lease'], 'versionId': prepared['versionId'], 'chunkCount': count})
            return {'url': document['url'], 'pages': total, 'readablePages': readable, 'chunks': count}

    def prepare(self, job):
        discovery_path = self.state / ('discovery-' + hashlib.sha256(json.dumps(job['company'],sort_keys=True).encode()).hexdigest() + '.json')
        if discovery_path.exists() and time.time()-discovery_path.stat().st_mtime<86400:
            discovery = json.loads(discovery_path.read_text())
            candidates, diagnostics = discovery['documents'], discovery['diagnostics']
        else:
            candidates, diagnostics = discover(job['company'], lambda s,p: self.progress(job,s,p))
            discovery_path.write_text(json.dumps({'documents':candidates,'diagnostics':diagnostics}))
        completed, failures = [], []
        counts = {'annual_report':0,'earnings_call':0}
        for i, document in enumerate(candidates):
            if counts[document['type']] >= (2 if document['type']=='annual_report' else 6):
                continue
            self.progress(job, 'Preparing document ' + str(i + 1) + ' of ' + str(len(candidates)), {'completed': len(completed), 'candidates': len(candidates), 'failures': failures[-8:]})
            try:
                completed.append(self.process_document(job, document))
                counts[document['type']] += 1
            except Exception as error:
                reason = str(error) if isinstance(error, ResearchError) else type(error).__name__
                failures.append({'url': document['url'], 'reason': reason[:300]})
        self.progress(job, 'Recording document coverage', {'completed': len(completed), 'candidates': len(candidates), 'documents': completed, 'failures': failures, 'discoveryDiagnostics': diagnostics[-12:]})
        if not completed:
            raise ResearchError('No eligible document could be indexed; inspect discovery/extraction diagnostics')
        self.api('finish', {'jobId': job['id'], 'lease': job['lease'], 'error': 'Some documents could not be processed; inspect source coverage.' if failures else None})

    def answer(self, question):
        # Reuse the existing restricted, tool-free model transport. Retrieval is
        # performed by FINN's backend internal tools before supplying context.
        path = Path('/home/azureuser/finn-personal/worker.py')
        spec = importlib.util.spec_from_file_location('finn_codex_transport', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        work = self.state / 'model-work'
        work.mkdir(exist_ok=True)
        previous = Path.cwd()
        os.chdir(work)
        client = None
        try:
            client = module.Codex('/home/azureuser/.local/bin/codex', str(work))
            answer = client.analyse(question)
            self.api('question/complete', {'id': question['id'], 'lease': question['lease'], 'answer': answer})
        finally:
            if client:
                client.close()
            os.chdir(previous)

    def tick(self):
        self.heartbeat()
        if available_memory() < 180:
            print(json.dumps({'status': 'deferred', 'reason': 'low_memory', 'availableMb': available_memory()}), flush=True)
            return
        if self.model_ready():
            question = self.api('question/claim', {}).get('question')
            if question:
                try:
                    self.answer(question)
                except Exception:
                    self.api('question/failed', {'id': question['id'], 'lease': question['lease']})
                return
        job = self.api('claim', {}).get('job')
        if job:
            try:
                self.prepare(job)
                print(json.dumps({'ticker': job['ticker'], 'status': 'prepared'}), flush=True)
            except Exception as error:
                reason = str(error) if isinstance(error, ResearchError) else type(error).__name__
                self.api('failed', {'jobId': job['id'], 'lease': job['lease'], 'error': reason[:500]})
                print(json.dumps({'ticker': job['ticker'], 'status': 'preparation_error', 'reason': reason[:300]}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/home/azureuser/finn-personal/config.json'))
    parser.add_argument('--state', type=Path, default=Path('/var/lib/finn-research'))
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--discover')
    parser.add_argument('--source', action='append', default=[])
    args = parser.parse_args()
    if args.discover:
        documents, diagnostics = discover({'ticker': args.discover, 'sources': args.source})
        print(json.dumps({'documents': documents, 'diagnostics': diagnostics}, indent=2))
        return
    config = json.loads(args.config.read_text())
    if args.config.stat().st_mode & 0o077:
        raise ResearchError('Worker configuration must have owner-only permissions')
    worker = Worker(config, args.state)
    if args.bootstrap:
        print(json.dumps(worker.api('bootstrap', {})))
        return
    while True:
        try:
            worker.tick()
        except Exception as error:
            print(json.dumps({'status': 'worker_error', 'errorType': type(error).__name__, 'reason':str(error)[:300] if isinstance(error,ResearchError) else 'Worker operation failed'}), flush=True)
        if args.once:
            return
        time.sleep(20)


if __name__ == '__main__':
    main()
