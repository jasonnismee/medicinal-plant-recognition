"""Gửi ảnh từ máy tính giống ESP32-CAM qua multipart HTTP."""
import argparse, io, time
import requests
from PIL import Image, ImageOps

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--url',default='http://127.0.0.1:8000/api/predict')
    ap.add_argument('--image',required=True)
    ap.add_argument('--width',type=int,default=640)
    ap.add_argument('--height',type=int,default=480)
    ap.add_argument('--quality',type=int,default=60)
    ap.add_argument('--key',default='')
    args=ap.parse_args()
    with Image.open(args.image) as im:
        im=ImageOps.exif_transpose(im).convert('RGB')
        im.thumbnail((args.width,args.height),Image.Resampling.LANCZOS)
        buf=io.BytesIO();im.save(buf,format='JPEG',quality=args.quality)
    headers={'X-Source':'esp32'}
    if args.key:headers['X-Device-Key']=args.key
    started=time.perf_counter()
    resp=requests.post(args.url,files={'file':('capture.jpg',buf.getvalue(),'image/jpeg')},headers=headers,timeout=120)
    print('HTTP',resp.status_code,'Latency (ms):',round((time.perf_counter()-started)*1000,1))
    print(resp.text)
    resp.raise_for_status()
if __name__=='__main__':main()
