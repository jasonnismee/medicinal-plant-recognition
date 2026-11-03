import io, os, time, uuid, sqlite3
from pathlib import Path
from contextlib import contextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, Header, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
import logging
from PIL import Image, ImageOps, UnidentifiedImageError
from .model import service, ROOT

MAX_BYTES = int(os.getenv('MAX_UPLOAD_MB','10')) * 1024 * 1024
STORE = Path(os.getenv('DATA_DIR', str(ROOT / 'data')))
STORE.mkdir(parents=True, exist_ok=True)
DB = STORE / 'events.sqlite3'
API_KEY = os.getenv('DEVICE_API_KEY','')
app = FastAPI(title='Medicinal Plant Recognition', version='1.0.1')
logger = logging.getLogger('uvicorn.error')

@contextmanager
def connection():
    db = sqlite3.connect(DB)
    try:
        yield db
        db.commit()
    finally:
        db.close()

with connection() as db:
    db.execute('CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP, source TEXT, filename TEXT, predicted TEXT, score REAL, inference_ms REAL)')

@app.get('/api/health')
def health():
    return {'status':'ok', 'model_loaded':service.model is not None, 'device':service.device, 'error':service.error}

@app.get('/api/species')
def species():
    return service.species

@app.post('/api/predict')
async def predict(file:UploadFile=File(...), x_device_key:str|None=Header(default=None), x_source:str|None=Header(default='web')):
    source = x_source if x_source in ('web','simulator','esp32') else 'web'
    if source == 'esp32' and API_KEY and x_device_key != API_KEY:
        raise HTTPException(401, 'Invalid device key')
    raw = await file.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES:
        raise HTTPException(413, 'Image too large')
    try:
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image)
        image.load()
        if image.width*image.height > 25_000_000:
            raise HTTPException(413, 'Image dimensions too large')
        image = image.convert('RGB')
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, 'Invalid image')
    logger.info("[predict] Received image %s (%sx%s); starting model", file.filename, image.width, image.height)
    started = time.perf_counter()
    try:
        # Run CPU/GPU model work off the FastAPI event loop.
        result = await run_in_threadpool(service.predict, image)
    except Exception as exc:
        logger.exception("[predict] Model failed after %.1fs", time.perf_counter() - started)
        raise HTTPException(503, f'Model unavailable: {str(exc)[:250]}')
    logger.info("[predict] Completed in %.1fs; status=%s", time.perf_counter() - started, result['status'])
    event_id = str(uuid.uuid4())
    top = result['predictions'][0]
    with connection() as db:
        db.execute('INSERT INTO events(id,source,filename,predicted,score,inference_ms) VALUES (?,?,?,?,?,?)', (event_id,source,(file.filename or '')[:200],(result['predicted_class'] or ('Không xác định' if result['status']=='unknown' else 'Chưa chắc chắn')),top['relative_score'],result['inference_ms']))
    return {'id':event_id,'source':source,**result}

@app.get('/api/history')
def history(limit:int=30):
    with connection() as db:
        db.row_factory=sqlite3.Row
        rows=db.execute('SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?', (max(1,min(limit,100)),)).fetchall()
        return [dict(x) for x in rows]

app.mount('/assets', StaticFiles(directory=str(ROOT/'frontend')), name='assets')
def is_mobile_user_agent(user_agent: str | None) -> bool:
    if not user_agent:
        return False
    ua = user_agent.lower()
    return any(k in ua for k in ('mobile', 'android', 'iphone', 'ipod', 'ipad', 'windows phone'))

@app.get('/')
def index(request: Request):
    view = request.query_params.get('view')
    if view == 'mobile' or (view != 'desktop' and is_mobile_user_agent(request.headers.get('user-agent'))):
        return FileResponse(ROOT / 'frontend' / 'mobile.html')
    return FileResponse(ROOT / 'frontend' / 'index.html')

@app.get('/mobile')
def mobile_view():
    return FileResponse(ROOT / 'frontend' / 'mobile.html')


# CameraWebServer remains the owner of the camera configuration.
# Only the trusted LAN host configured on the server is used (no user-provided URL).
ESP32_CAPTURE_URL = os.getenv('ESP32_CAPTURE_URL', 'http://192.168.1.153/capture')
ESP32_MAX_JPEG_BYTES = 10 * 1024 * 1024

@app.get('/api/esp32/capture')
def capture_esp32():
    from urllib.parse import urlparse
    from urllib.request import Request, urlopen
    from fastapi.responses import Response
    import ipaddress
    import socket

    url = urlparse(ESP32_CAPTURE_URL)
    # LAN-only: protect the proxy if the server is ever publicly exposed.
    if url.scheme != 'http' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path != '/capture':
        raise HTTPException(500, 'ESP32_CAPTURE_URL must be an HTTP camera /capture URL')
    try:
        addresses = socket.getaddrinfo(url.hostname, url.port or 80, type=socket.SOCK_STREAM)
        if not addresses or not all(ipaddress.ip_address(item[4][0]).is_private for item in addresses):
            raise ValueError('Camera must be on a private network')
        # Avoid DNS rebinding: use an IPv4 literal for this local demo.
        ipaddress.IPv4Address(url.hostname)
    except (ValueError, OSError, socket.gaierror):
        raise HTTPException(500, 'Configure ESP32_CAPTURE_URL with a private IPv4 LAN address')

    try:
        req = Request(ESP32_CAPTURE_URL, headers={'Accept': 'image/jpeg', 'Cache-Control': 'no-cache'})
        with urlopen(req, timeout=15) as remote:
            if remote.status != 200:
                raise HTTPException(502, 'ESP32-CAM did not return HTTP 200')
            raw = remote.read(ESP32_MAX_JPEG_BYTES + 1)
        if len(raw) > ESP32_MAX_JPEG_BYTES:
            raise HTTPException(502, 'Camera JPEG exceeds 10 MB')
        if len(raw) < 4 or not raw.startswith(bytes([0xFF, 0xD8])) or not raw.endswith(bytes([0xFF, 0xD9])):
            raise HTTPException(502, 'ESP32-CAM returned invalid JPEG data')
        with Image.open(io.BytesIO(raw)) as img:
            img.verify()
        return Response(content=raw, media_type='image/jpeg', headers={'Cache-Control':'no-store'})
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning('ESP32 capture failed: %s', exc)
        raise HTTPException(502, 'Cannot capture from ESP32-CAM. Check camera IP and Wi-Fi.')
