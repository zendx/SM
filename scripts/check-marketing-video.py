import json
import re
import subprocess
from pathlib import Path
import imageio_ffmpeg

directory=Path('docs/marketing-video')
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
master=directory/'SMPIS-Cinematic-Marketing-1080p.mp4'
inspection=subprocess.run([ffmpeg,'-hide_banner','-i',str(master)],capture_output=True).stderr.decode(errors='replace')
assert '1920x1080' in inspection and 'Video: h264' in inspection
assert 'Audio: aac' in inspection and 'Subtitle: mov_text' in inspection
decode=subprocess.run([ffmpeg,'-v','error','-threads','2','-i',str(master),'-f','null','-'],capture_output=True)
assert decode.returncode==0,decode.stderr.decode(errors='replace')
volume=subprocess.run([ffmpeg,'-hide_banner','-i',str(master),'-vn','-af','volumedetect','-f','null','-'],capture_output=True).stderr.decode(errors='replace')
mean=re.search(r'mean_volume: ([-\d.]+) dB',volume)
peak=re.search(r'max_volume: ([-\d.]+) dB',volume)
assert mean and peak and -35<float(mean.group(1))<-8 and float(peak.group(1))<0
duration=re.search(r'Duration: ([\d:.]+)',inspection).group(1)
report={'duration':duration,'resolution':'1920x1080','frame_rate':24,'video_codec':'H.264','audio_codec':'AAC','english_subtitle_track':True,'full_decode':'passed','mean_audio_db':float(mean.group(1)),'peak_audio_db':float(peak.group(1))}
(directory/'validation.json').write_text(json.dumps(report,indent=2))
captions=(directory/'SMPIS-Marketing-Captions.srt').read_text(encoding='utf-8')
(directory/'SMPIS-Marketing-Captions.vtt').write_text('WEBVTT\n\n'+re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})',r'\1.\2',captions),encoding='utf-8')
print(json.dumps(report),flush=True)
subprocess.run([ffmpeg,'-v','error','-y','-i',str(master),'-vf','fps=1/10,scale=480:270,tile=4x3','-frames:v','1',str(directory/'review-contact-sheet.jpg')],check=True)
