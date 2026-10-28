from __future__ import annotations

import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from google_auth_oauthlib.flow import InstalledAppFlow

from videocut import gdrive


class Handler(BaseHTTPRequestHandler):
    code = ""
    state = ""

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query)
        Handler.code = (query.get("code") or [""])[0]
        Handler.state = (query.get("state") or [""])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            "<!doctype html><meta charset=utf-8><p>Доступ получен. Окно можно закрыть.</p>".encode()
        )

    def log_message(self, *_args):
        return


flow = InstalledAppFlow.from_client_secrets_file(str(gdrive._client_secret_path()), gdrive.SCOPES)
server = HTTPServer(("localhost", 0), Handler)
port = server.server_port
flow.redirect_uri = f"http://localhost:{port}/"
url, _ = flow.authorization_url(access_type="offline", prompt="consent")
print(f"URL: {url}", flush=True)
webbrowser.open(url)
server.handle_request()
if not Handler.code:
    raise SystemExit("Код авторизации не получен")
flow.fetch_token(code=Handler.code)
gdrive.save_credentials(flow.credentials)
svc = gdrive.service(interactive=False)
print(f"ACCOUNT: {gdrive.account_email(svc)}", flush=True)
parent = svc.files().get(
    fileId="16IBd36gvDe3tGQk8urKPKk55yQrn9JCE",
    fields="id,name,mimeType,driveId",
    supportsAllDrives=True,
).execute()
print(f"PARENT: {parent.get('name')} drive={bool(parent.get('driveId'))}", flush=True)
