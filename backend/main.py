import io, os, time, uuid, sqlite3
from pathlib import Path
from contextlib import contextmanager
from fastapi import FastAPI, File, UploadFile, HTTPException, Header
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
@app.get('/')
def index():
    return FileResponse(ROOT/'frontend'/'index.html')
