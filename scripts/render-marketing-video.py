"""Build a narrated, scored 1080p SMPIS promotional film from local scene plates."""
import asyncio
import json
import math
import re
import subprocess
import wave
from pathlib import Path

import edge_tts
import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs' / 'marketing-video'
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SCENES = json.loads((OUT / 'scenes.json').read_text(encoding='utf-8'))
for folder in ['audio', 'clips']:
    (OUT / folder).mkdir(exist_ok=True)

def run(args):
    result = subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace')[-4000:])

def duration(file):
    result = subprocess.run([FFMPEG,'-hide_banner','-i',str(file)],capture_output=True)
    found = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',result.stderr.decode(errors='replace'))
    if not found:
        raise RuntimeError('Unable to inspect '+str(file))
    h,m,s=map(float,found.groups())
    return h*3600+m*60+s

async def narration():
    semaphore=asyncio.Semaphore(2)
    async def speak(i,scene):
        destination=OUT/'audio'/f'voice-{i:02}.mp3'
        local_wave=OUT/'audio'/f'voice-{i:02}.wav'
        if local_wave.exists():
            run(['-i',local_wave,'-c:a','libmp3lame','-b:a','192k',destination])
            return
        if destination.exists() and destination.stat().st_size>1000:
            return
        async with semaphore:
            for attempt in range(3):
                try:
                    voice=edge_tts.Communicate(scene['voice'],'en-NG-AbeoNeural',rate='+2%',pitch='-3Hz')
                    await voice.save(str(destination))
                    print(f'Voiceover {i+1} ready',flush=True)
                    return
                except Exception:
                    if attempt==2: raise
                    await asyncio.sleep(1)
    await asyncio.gather(*(speak(i,s) for i,s in enumerate(SCENES)))

def wavefile(destination,samples,rate=48000):
    pcm=(np.clip(samples,-1,1)*32767).astype('<i2')
    with wave.open(str(destination),'wb') as f:
        f.setnchannels(2 if pcm.ndim==2 else 1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(pcm.tobytes())

def score(length):
    """Original instrumental: warm pads, soft bell arpeggios and low pulses."""
    rate=48000
    count=math.ceil((length+1)*rate)
    music=np.zeros((count,2),dtype=np.float32)
    chords=[[52,55,59,64],[48,52,55,60],[43,47,50,55],[50,54,57,62]]
    def add_note(start,seconds,midi,amplitude,pan,kind):
        offset=int(start*rate); size=min(int(seconds*rate),count-offset)
        if size<=0:return
        t=np.arange(size,dtype=np.float32)/rate
        hz=440*2**((midi-69)/12)
        if kind=='pad':
            env=np.minimum(t/1.2,1)*np.minimum((seconds-t)/1.4,1)
            signal=(np.sin(2*np.pi*hz*t)+.3*np.sin(2*np.pi*hz*1.002*t)+.16*np.sin(2*np.pi*hz*2*t))*env
        else:
            env=(1-np.exp(-t*55))*np.exp(-t*1.5)
            signal=(np.sin(2*np.pi*hz*t)+.32*np.sin(2*np.pi*hz*2*t)+.1*np.sin(2*np.pi*hz*3*t))*env
        for ch,gain in enumerate([math.sqrt(1-pan),math.sqrt(pan)]):
            music[offset:offset+size,ch]+=signal*amplitude*gain
    for bar,start in enumerate(np.arange(0,length,6.66)):
        chord=chords[bar%4]
        for j,midi in enumerate(chord):add_note(start,8,midi,.035,.25+j*.16,'pad')
        for k in range(8):add_note(start+k*.833,3,chord[k%4]+12,.055,.32+.36*(k%2),'bell')
        add_note(start,4,chord[0]-12,.04,.5,'bell')
    t=np.arange(count,dtype=np.float32)/rate
    fade=np.minimum(t/3,1)*np.minimum(np.maximum(length-t,0)/4,1)
    music*=fade[:,None]
    wavefile(OUT/'audio'/'original-score.wav',music)

def timestamp(seconds):
    millis=round(seconds*1000);h,millis=divmod(millis,3600000);m,millis=divmod(millis,60000);s,millis=divmod(millis,1000)
    return f'{h:02}:{m:02}:{s:02},{millis:03}'

asyncio.run(narration())
timeline=[]
position=0
for i,scene in enumerate(SCENES):
    voiced=duration(OUT/'audio'/f'voice-{i:02}.mp3')
    seconds=math.ceil(max(scene['duration'],voiced+1.25)*24)/24
    timeline.append({'scene':i,'start':position,'duration':seconds,'voice_duration':voiced})
    position+=seconds
(OUT/'timeline.json').write_text(json.dumps(timeline,indent=2))
print(f'Film duration: {position:.2f}s',flush=True)
subtitles=[]
for i,item in enumerate(timeline):
    sentences=re.split(r'(?<=[.!?])\s+',SCENES[i]['voice'])
    weight=sum(len(s) for s in sentences);elapsed=item['start']+.55
    for sentence in sentences:
        span=item['voice_duration']*len(sentence)/weight
        subtitles.append(f'{len(subtitles)+1}\n{timestamp(elapsed)} --> {timestamp(elapsed+span)}\n{sentence}\n')
        elapsed+=span
(OUT/'SMPIS-Marketing-Captions.srt').write_text('\n'.join(subtitles),encoding='utf-8')
(OUT/'SMPIS-Marketing-Captions.vtt').write_text('WEBVTT\n\n'+re.sub(r'(\d{2}:\d{2}:\d{2}),(\d{3})',r'\1.\2','\n'.join(subtitles)),encoding='utf-8')
for i,item in enumerate(timeline):
    seconds=item['duration'];frames=round(seconds*24)
    target=OUT/'clips'/f'scene-{i:02}.mp4'
    if target.exists() and abs(duration(target)-seconds)<.1:
        print(f'Using rendered scene {i+1}',flush=True)
        continue
    zoom=f"scale=3840:2160,zoompan=z='1+0.018*on/{frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d={frames}:s=1920x1080:fps=24,fade=t=in:st=0:d=0.35,fade=t=out:st={seconds-.35}:d=0.35,format=yuv420p"
    run(['-i',OUT/'frames'/f'scene-{i:02}.png','-vf',zoom,'-frames:v',frames,'-an','-c:v','libx264','-preset','fast','-crf','20','-threads','4',target])
    print(f'Encoded cinematic scene {i+1}/10',flush=True)
playlist=OUT/'clips'/'concat.txt'
playlist.write_text('\n'.join(f"file 'scene-{i:02}.mp4'" for i in range(len(SCENES))))
run(['-f','concat','-safe','0','-i',playlist,'-c','copy',OUT/'clips'/'picture.mp4'])
score(position)
args=[]
for i in range(len(SCENES)):args+=['-i',OUT/'audio'/f'voice-{i:02}.mp3']
filters=[]
for i,item in enumerate(timeline):
    delay=round((item['start']+.55)*1000)
    filters.append(f'[{i}:a]adelay={delay}:all=1[v{i}]')
filters.append(''.join(f'[v{i}]' for i in range(len(SCENES)))+f'amix=inputs={len(SCENES)}:normalize=0,apad,atrim=0:{position}[voice]')
run([*args,'-filter_complex',';'.join(filters),'-map','[voice]','-ar','48000',OUT/'audio'/'narration.wav'])
run(['-i',OUT/'clips'/'picture.mp4','-i',OUT/'audio'/'narration.wav','-i',OUT/'audio'/'original-score.wav','-i',OUT/'SMPIS-Marketing-Captions.srt','-filter_complex',f'[1:a]loudnorm=I=-16:TP=-2:LRA=9[vo];[2:a]volume=0.55[music];[vo][music]amix=inputs=2:normalize=0,alimiter=limit=0.92,afade=t=out:st={position-2}:d=2[mix]','-map','0:v','-map','[mix]','-map','3:s','-c:v','copy','-c:a','aac','-b:a','192k','-c:s','mov_text','-metadata:s:s:0','language=eng','-metadata','title=SMPIS — More Possibility','-metadata','comment=AI-generated cinematic pictorials; actual SMPIS demo portal screens; synthetic English narration; original generated instrumental.','-movflags','+faststart','-t',position,OUT/'SMPIS-Cinematic-Marketing-1080p.mp4'])
run(['-i',OUT/'SMPIS-Cinematic-Marketing-1080p.mp4','-vf','scale=1280:720','-c:v','libx264','-preset','fast','-crf','25','-threads','4','-c:a','aac','-b:a','128k','-movflags','+faststart',OUT/'SMPIS-Marketing-Share-720p.mp4'])
run(['-ss',position-5,'-i',OUT/'SMPIS-Cinematic-Marketing-1080p.mp4','-frames:v','1',OUT/'SMPIS-Marketing-Poster.jpg'])
print('Finished 1080p film, compact 720p copy, captions and poster.',flush=True)
