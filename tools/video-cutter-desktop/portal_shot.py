from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu")

from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("usage: portal_shot.py URL OUT.png")
    url, out = sys.argv[1], Path(sys.argv[2])
    app = QApplication([])
    view = QWebEngineView()
    view.resize(1500, 1200)
    view.show()
    attempts = {"n": 0}

    def shoot() -> None:
        out.parent.mkdir(parents=True, exist_ok=True)
        view.grab().save(str(out))
        print(f"OK {out}", flush=True)
        app.quit()

    def check() -> None:
        attempts["n"] += 1
        js = """(function(){
          var card = document.getElementById('last-card');
          if (!card) return 0;
          card.scrollIntoView({block:'start'});
          return card.querySelectorAll('a.video-link, #last-head-video a').length ? 2 : 1;
        })()"""
        view.page().runJavaScript(js, lambda value: QTimer.singleShot(1200 if value == 2 else 700, shoot if value == 2 or attempts["n"] >= 20 else check))

    def loaded(ok: bool) -> None:
        if not ok:
            print("LOAD_FAILED", flush=True)
            app.quit()
            return
        QTimer.singleShot(2500, check)

    view.loadFinished.connect(loaded)
    view.load(QUrl(url))
    QTimer.singleShot(40000, shoot)
    app.exec()


if __name__ == "__main__":
    main()
