"""Private streaming artifact service; deploy behind an HTTPS reverse proxy."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlsplit

ROOT = Path(os.environ.get('FINN_ARTIFACT_ROOT', '/var/lib/finn-research/artifacts')).resolve()
CACHE = Path(os.environ.get('FINN_PDF_CACHE', '/var/lib/finn-research/cache')).resolve()
TOKEN = os.environ.get('FINN_VM_STORAGE_TOKEN', '')
LIMIT = 64 * 1024 * 1024
SLOTS = threading.BoundedSemaphore(4)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, *_args):
        pass  # No request paths, tokens, provider responses or document text.

    def reject(self, status):
        self.close_connection = True
        self.send_response(status)
        self.send_header('Content-Length', '0')
        self.send_header('Connection', 'close')
        self.end_headers()

    def artifact(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            self.reject(401)
            return None
        parsed = urlsplit(self.path)
        match = re.fullmatch(r'/v1/artifacts/research/([a-f0-9]{2})/([a-f0-9]{64})\.(pdf|jsonl)', parsed.path)
        if not match or parsed.query or match[1] != match[2][:2]:
            self.reject(404)
            return None
        return ROOT / 'research' / match[1] / (match[2] + '.' + match[3]), match[2], match[3]

    def read_request(self, sink):
        total, digest = 0, hashlib.sha256()

        def copy(length):
            nonlocal total
            if length < 0 or total + length > LIMIT:
                raise ValueError('Upload exceeds limit')
            while length:
                data = self.rfile.read(min(length, 65536))
                if not data:
                    raise ValueError('Incomplete upload')
                total += len(data)
                length -= len(data)
                digest.update(data)
                sink.write(data)

        transfer = self.headers.get('Transfer-Encoding', '').lower()
        content_length = self.headers.get('Content-Length')
        if transfer:
            if transfer != 'chunked' or content_length is not None:
                raise ValueError('Invalid upload framing')
            while True:
                line = self.rfile.readline(128)
                if not line.endswith(b'\r\n') or not re.fullmatch(rb'[0-9a-fA-F]+\r\n', line):
                    raise ValueError('Invalid chunk')
                length = int(line, 16)
                if not length:
                    if self.rfile.readline(4) != b'\r\n':
                        raise ValueError('Unsupported trailers')
                    break
                copy(length)
                if self.rfile.read(2) != b'\r\n':
                    raise ValueError('Invalid chunk ending')
        elif content_length is not None and content_length.isdigit():
            copy(int(content_length))
        else:
            raise ValueError('Upload length required')
        if not total:
            raise ValueError('Empty upload')
        return digest.hexdigest()

    def do_PUT(self):
        target = self.artifact()
        if target is None:
            return
        if not SLOTS.acquire(blocking=False):
            self.reject(503)
            return
        temporary = None
        try:
            file, expected, extension = target
            file.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=file.parent, delete=False) as output:
                temporary = Path(output.name)
                digest = self.read_request(output)
                output.flush()
                os.fsync(output.fileno())
            if extension == 'pdf' and digest != expected:
                raise ValueError('PDF hash mismatch')
            os.replace(temporary, file)
            temporary = None
            self.send_response(200)
            self.send_header('Content-Length', '0')
            self.end_headers()
        except (ValueError, OSError):
            self.reject(400)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            SLOTS.release()

    def do_HEAD(self):
        self.download(head=True)

    def do_GET(self):
        self.download(head=False)

    def download(self, head):
        target = self.artifact()
        if target is None:
            return
        file, digest, extension = target
        # Existing originals already have content-addressed filenames. Serving
        # them in place avoids duplicating hundreds of MiB during migration.
        if not file.is_file() and extension == 'pdf':
            file = CACHE / (digest + '.pdf')
        if not file.is_file():
            self.reject(404)
            return
        if not SLOTS.acquire(blocking=False):
            self.reject(503)
            return
        try:
            size, offset, status = file.stat().st_size, 0, 200
            end = size - 1
            value = self.headers.get('Range')
            if value:
                match = re.fullmatch(r'bytes=(\d+)-(\d+)', value)
                if not match or not 0 <= int(match[1]) <= int(match[2]) < size:
                    self.reject(416)
                    return
                offset, end, status = int(match[1]), int(match[2]), 206
            self.send_response(status)
            self.send_header('Content-Type', 'application/pdf' if extension == 'pdf' else 'application/x-ndjson')
            self.send_header('Content-Length', str(end - offset + 1))
            self.send_header('Accept-Ranges', 'bytes')
            if status == 206:
                self.send_header('Content-Range', f'bytes {offset}-{end}/{size}')
            self.end_headers()
            if not head:
                with file.open('rb') as source:
                    source.seek(offset)
                    remaining = end - offset + 1
                    while remaining:
                        data = source.read(min(remaining, 65536))
                        if not data:
                            break
                        self.wfile.write(data)
                        remaining -= len(data)
        except (OSError, ConnectionError):
            self.close_connection = True
        finally:
            SLOTS.release()


if __name__ == '__main__':
    if len(TOKEN) < 32:
        raise SystemExit('Configure FINN_VM_STORAGE_TOKEN with at least 32 random characters')
    ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('FINN_STORAGE_PORT', '8891'))), Handler)
    server.daemon_threads = True
    server.serve_forever()
