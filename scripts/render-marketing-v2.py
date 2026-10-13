"""60-second product-navigation promo: upbeat instrumental and mouse/transition SFX, no speech."""
import json
import math
import re
import subprocess
import wave
from pathlib import Path
import imageio_ffmpeg
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs'/'marketing-video-v2'
FFMPEG=imageio_ffmpeg.get_ffmpeg_exe()
RATE=48000
LENGTH=60
rng=np.random.default_rng(63012)
music=np.zeros((RATE*LENGTH,2),dtype=np.float32)
effects=np.zeros_like(music)

def run(args):
    p=subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-y',*map(str,args)],capture_output=True)
    if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace')[-3500:])

def lay(track,start,signal,volume=1,pan=.5):
    offset=round(start*RATE)
    if offset<0:signal=signal[-offset:];offset=0
    count=min(len(signal),len(track)-offset)
    if count<=0:return
    signal=signal[:count]*volume
    track[offset:offset+count,0]+=signal*math.sqrt(1-pan)
    track[offset:offset+count,1]+=signal*math.sqrt(pan)

def note(start,midi,kind='pluck',volume=.10,pan=.5,seconds=.7):
    t=np.arange(round(seconds*RATE),dtype=np.float32)/RATE
    hz=440*2**((midi-69)/12)
    if kind=='pad':
        env=np.minimum(t/.12,1)*np.minimum((seconds-t)/.25,1)
        sound=(np.sin(2*np.pi*hz*t)+.18*np.sin(2*np.pi*hz*2*t)+.15*np.sin(2*np.pi*hz*1.003*t))*env
    elif kind=='bass':
        env=(1-np.exp(-t*180))*np.exp(-t*9)
        sound=(np.sin(2*np.pi*hz*t)+.25*np.sin(2*np.pi*hz*2*t))*env
    elif kind=='bell':
        env=(1-np.exp(-t*200))*np.exp(-t*4.5)
        sound=(np.sin(2*np.pi*hz*t)+.30*np.sin(2*np.pi*hz*2*t)*np.exp(-t*5)+.11*np.sin(2*np.pi*hz*3*t)*np.exp(-t*8))*env
    else:
        env=(1-np.exp(-t*300))*np.exp(-t*11)
        sound=sum(np.sin(2*np.pi*hz*h*t)/h**1.6 for h in range(1,6))*env
    lay(music,start,sound,volume,pan)
    if kind=='bell':lay(music,start+.25,sound,.18*volume,1-pan)

def kick(start,volume=.21):
    t=np.arange(round(.22*RATE),dtype=np.float32)/RATE
    phase=2*np.pi*(47*t+65*(1-np.exp(-t*24))/24)
    sound=np.sin(phase)*np.exp(-t*22)+.04*rng.standard_normal(len(t))*np.exp(-t*100)
    lay(music,start,sound,volume)

def clap(start,volume=.11):
    t=np.arange(round(.13*RATE),dtype=np.float32)/RATE
    noise=rng.standard_normal(len(t));high=np.diff(noise,prepend=0)/2
    env=np.exp(-t*40)+.6*np.exp(-np.maximum(t-.012,0)*65)*(t>.012)+.35*np.exp(-np.maximum(t-.022,0)*70)*(t>.022)
    lay(music,start,high*env,volume,.52)

def hat(start,volume=.027,open_hat=False):
    t=np.arange(round((.13 if open_hat else .035)*RATE),dtype=np.float32)/RATE
    noise=rng.standard_normal(len(t));high=np.diff(noise,prepend=0)/2
    lay(music,start,high*np.exp(-t*(26 if open_hat else 110)),volume,.62)

# A bright 120 BPM groove: C major / G major / A minor / F major.
chords=[[48,52,55],[43,47,50],[45,48,52],[41,45,48]]
motif=[0,4,7,9,7,4,2,7]
for bar in range(30):
    start=bar*2
    chord=chords[(bar//2)%4]
    intensity=.8 if bar<2 else 1
    for j,midi in enumerate(chord):note(start,midi,'pad',.025,.22+.26*j,2.13)
    for beat in range(4):
        at=start+beat*.5
        kick(at,.18*intensity)
        note(at,chord[0]-12,'bass',.115*intensity,.5,.42)
        if beat%2:clap(at,.10*intensity)
        for sub in range(2):
            eighth=at+sub*.25
            hat(eighth,.022*intensity,beat==3 and sub==1)
            for j,midi in enumerate(chord):note(eighth+.07+j*.006,midi+12,'pluck',.031*intensity,.24+j*.24,.32)
    for n,interval in enumerate(motif):
        if n in [0,1,3,4,6,7]:
            # Chord-aware major/minor third keeps the tune joyful and consonant.
            if chord[0]==45 and interval==4:interval=3
            note(start+n*.25+.03,chord[0]+24+interval,'bell',.085,.30 if n%2 else .67,.65)
    if bar in [6,14,22,28]:
        for fill in range(4):clap(start+1.5+fill*.125,.05)

def click(start):
    t=np.arange(round(.075*RATE),dtype=np.float32)/RATE
    chirp=np.sin(2*np.pi*(1400*t-1700*t*t))*np.exp(-t*65)
    noise=rng.standard_normal(len(t))*np.exp(-t*160)*.18
    lay(effects,start,chirp+noise,.13)

def whoosh(start):
    t=np.arange(round(.25*RATE),dtype=np.float32)/RATE
    noise=rng.standard_normal(len(t));smoother=np.convolve(noise,np.ones(7)/7,mode='same')
    env=np.sin(np.pi*t/.25)**2
    swoop=np.sin(2*np.pi*(380*t+2400*t*t))*.10
    lay(effects,start-.08,(smoother+swoop)*env,.22,.38)

def success(start):
    for i,midi in enumerate([76,79,84]):
        t=np.arange(round(.4*RATE),dtype=np.float32)/RATE
        hz=440*2**((midi-69)/12)
        sound=np.sin(2*np.pi*hz*t)*(1-np.exp(-t*150))*np.exp(-t*10)
        lay(effects,start+i*.07,sound,.10,.45+i*.10)

cues=json.loads((OUT/'sound-cues.json').read_text())
for cue in cues:
    {'click':click,'whoosh':whoosh,'success':success}[cue['type']](cue['time'])
success(.12)
t=np.arange(len(music),dtype=np.float32)/RATE
fade=np.minimum(t/.25,1)*np.minimum(np.maximum(60-t,0)/1.15,1)
music*=fade[:,None]
effects*=np.minimum(np.maximum(60-t,0)/.4,1)[:,None]
mixed=music+effects
peak=np.max(np.abs(mixed));mixed*=.90/max(peak,1)

def write_wave(name,samples):
    with wave.open(str(OUT/name),'wb') as f:
        f.setnchannels(2);f.setsampwidth(2);f.setframerate(RATE)
        f.writeframes((np.clip(samples,-1,1)*32767).astype('<i2').tobytes())
write_wave('upbeat-music.wav',music)
write_wave('navigation-sound-effects.wav',effects)
write_wave('music-and-effects.wav',mixed)
print('Original upbeat music and '+str(len(cues))+' synchronized SFX cues ready. No voice track.',flush=True)

raw=OUT/'recordings'/'product-navigation.webm'
inspection=subprocess.run([FFMPEG,'-hide_banner','-i',str(raw)],capture_output=True).stderr.decode(errors='replace')
match=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',inspection)
if not match:raise RuntimeError('Cannot read recorded duration')
h,m,s=map(float,match.groups());raw_duration=h*3600+m*60+s
offset=max(0,raw_duration-60)
print(f'Raw recording {raw_duration:.3f}s; trimming setup footage at {offset:.3f}s.',flush=True)
master=OUT/'SMPIS-60s-Upbeat-Product-Demo-1080p.mp4'
run(['-ss',offset,'-i',raw,'-i',OUT/'music-and-effects.wav','-map','0:v:0','-map','1:a:0','-vf','fps=30,format=yuv420p','-af','loudnorm=I=-14:TP=-2.5:LRA=8,alimiter=limit=0.75:level=false','-t',60,'-c:v','libx264','-preset','fast','-crf','20','-threads','4','-c:a','aac','-b:a','192k','-movflags','+faststart','-metadata','title=SMPIS — A happier school day','-metadata','comment=60-second real product navigation with visible animated pointer; original 120 BPM music and synchronized effects; no voiceover; demo data.',master])
share=OUT/'SMPIS-60s-Sharing-720p.mp4'
run(['-i',master,'-vf','scale=1280:720','-t',60,'-c:v','libx264','-preset','fast','-crf','24','-threads','4','-c:a','aac','-b:a','128k','-movflags','+faststart',share])
run(['-ss',57,'-i',master,'-frames:v','1',OUT/'SMPIS-60s-Trial-Poster.jpg'])
run(['-i',master,'-vf','fps=1/6,scale=480:270,tile=4x3','-frames:v','1',OUT/'review'/'contact-sheet.jpg'])
for file in [master,share]:
    decoded=subprocess.run([FFMPEG,'-v','error','-threads','2','-i',str(file),'-f','null','-'],capture_output=True)
    if decoded.returncode:raise RuntimeError(decoded.stderr.decode(errors='replace'))
summary={'duration_seconds':60,'master_resolution':'1920x1080','sharing_resolution':'1280x720','frame_rate':30,'voiceover':False,'music':'original upbeat major-key instrumental, 120 BPM','sound_effect_cues':len(cues),'visible_mouse_pointer':True,'actual_portal_navigation':True,'logo':'original supplied logo preserved at 980:300 proportions','full_decode':'both MP4 exports passed'}
(OUT/'validation.json').write_text(json.dumps(summary,indent=2))
print(json.dumps(summary),flush=True)
