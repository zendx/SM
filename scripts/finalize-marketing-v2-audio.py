import subprocess
import re
import json
from pathlib import Path
import imageio_ffmpeg

folder=Path('docs/marketing-video-v2').resolve()
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
for name,bitrate in [('SMPIS-60s-Upbeat-Product-Demo-1080p.mp4','192k'),('SMPIS-60s-Sharing-720p.mp4','128k')]:
    target=folder/name
    temporary=folder/('audio-final-'+name)
    subprocess.run([ffmpeg,'-v','error','-y','-i',str(target),'-i',str(folder/'music-and-effects.wav'),'-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-14:TP=-2.5:LRA=8,alimiter=limit=0.75:level=false','-c:a','aac','-b:a',bitrate,'-t','60','-movflags','+faststart',str(temporary)],check=True)
    temporary.replace(target)
    check=subprocess.run([ffmpeg,'-hide_banner','-i',str(target),'-vn','-af','volumedetect','-f','null','-'],capture_output=True).stderr.decode(errors='replace')
    peak=float(re.search(r'max_volume: ([-\d.]+)',check).group(1))
    assert peak<-.2,peak
    print(name+': audio peak '+str(peak)+' dB',flush=True)
report=folder/'validation.json'
data=json.loads(report.read_text());data['audio_peak_check']='both exports below -0.2 dB';report.write_text(json.dumps(data,indent=2))
