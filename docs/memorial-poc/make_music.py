import numpy as np, wave

SR = 44100
DUR = 12.0
N = int(SR*DUR)
t = np.linspace(0, DUR, N, endpoint=False)
buf = np.zeros(N)

def hz(m): return 440.0*2**((m-69)/12.0)

# MIDI
D2,F2,A2,Bb2=38,41,45,46
C3,D3,E3,F3,G3,A3,Bb3=48,50,52,53,55,57,58
C4,D4,E4,F4,G4,A4,Bb4=60,62,64,65,67,69,70
C5,D5,E5,F5,G5,A5=72,74,76,77,79,81

def smoothstep(x): return np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))

def env_ar(tt, dur, atk, rel):
    a = smoothstep(tt/atk)
    r = smoothstep((dur-tt)/rel)
    return a*r

def place(sig, start):
    i0=int(start*SR); i1=min(N,i0+len(sig))
    buf[i0:i1]+=sig[:i1-i0]

# ---- CUERDAS cálidas (ensemble detune suave, low-passable) ----
def strings(note, start, dur, amp):
    n=int(dur*SR); tt=np.linspace(0,dur,n,endpoint=False)
    f=hz(note)
    vib=1+0.004*np.sin(2*np.pi*5.0*tt)      # vibrato leve
    voices=[0.0,-0.06,0.06]                 # 3 voces ±6 cent (ensemble)
    sig=np.zeros(n)
    for dv in voices:
        ff=f*2**(dv/12.0)*vib
        ph=2*np.pi*ff*tt
        # timbre tipo cuerda suave: armónicos decrecientes
        s=(np.sin(ph)+0.5*np.sin(2*ph)+0.33*np.sin(3*ph)
           +0.22*np.sin(4*ph)+0.14*np.sin(5*ph)+0.09*np.sin(6*ph))
        sig+=s
    sig/=len(voices)
    sig*=env_ar(tt,dur,0.45,0.9)*amp
    place(sig,start)

# ---- CAJA DE MÚSICA / celesta (afinada, dulce) ----
def musicbox(note, start, dur, amp):
    n=int(dur*SR); tt=np.linspace(0,dur,n,endpoint=False)
    f=hz(note); ph=2*np.pi*f*tt
    trem=1+0.05*np.sin(2*np.pi*4.5*tt)
    s=(np.sin(ph)+0.35*np.sin(2*ph)+0.12*np.sin(3*ph)+0.05*np.sin(4*ph))
    s+=0.10*np.sin(2*ph)   # leve brillo octava
    dec=np.exp(-tt/(dur*0.5))
    atk=smoothstep(tt/0.005)
    place(s*dec*atk*trem*amp, start)

# ---- BAJO suave ----
def bass(note,start,dur,amp):
    n=int(dur*SR); tt=np.linspace(0,dur,n,endpoint=False)
    f=hz(note); ph=2*np.pi*f*tt
    s=np.sin(ph)+0.25*np.sin(2*ph)
    place(s*np.exp(-tt/(dur*0.6))*smoothstep(tt/0.02)*amp, start)

# ============ ARREGLO (Re menor, ~65 BPM) ============
# Progresión: Dm - Bb - C - F  (i - VI - VII - III), cierra en Fa mayor (esperanza)
bars=[
 ('Dm',[D3,F3,A3,D4], D2),
 ('Bb',[Bb2,D3,F3,Bb3], Bb2-12),
 ('C', [C3,E3,G3,C4], C3-12),
 ('F', [F2,A2,C3,F3,A3], F2),
]
BAR=3.0
for k,(name,chord,root) in enumerate(bars):
    s=k*BAR
    for j,nn in enumerate(chord):
        strings(nn, s, BAR+0.5, 0.075)      # pad sostenido, solapa al siguiente
    bass(root, s, 2.7, 0.16)
    bass(root, s+1.5, 1.4, 0.10)
    # arpegio caja de música (corcheas suaves) subiendo por el acorde
    arp=chord+[chord[1]+12]
    for a_i in range(6):
        note=arp[a_i % len(arp)]
        musicbox(note, s+a_i*0.5, 1.2, 0.05)

# ---- MELODÍA lírica y conectada (arco que sube y resuelve en Fa) ----
mel=[
 (A4,0.5,1.6,0.24),(D5,2.0,1.3,0.22),      # Dm
 (F5,3.3,1.4,0.22),(D5,4.6,1.2,0.20),      # Bb (D es tono del acorde, evita choque)
 (E5,6.1,1.2,0.22),(G5,7.3,1.6,0.20),      # C
 (F5,9.0,1.3,0.22),(A4,10.2,1.0,0.20),(F4,11.0,1.8,0.22),  # F (resuelve)
]
for nn,s,d,a in mel:
    musicbox(nn,s,d,a)

# ================= POST =================
# Reverb de sala (varias reflexiones decrecientes)
def reverb(x,taps):
    y=x.copy()
    for ms,g in taps:
        d=int(SR*ms/1000)
        if d<len(x): y[d:]+=g*x[:len(x)-d]
    return y
buf=reverb(buf,[(60,0.30),(110,0.24),(170,0.18),(250,0.12),(360,0.08),(520,0.05)])

# Low-pass (calidez) — filtro one-pole suave
def onepole_lp(x,cut,sr):
    dt=1.0/sr; rc=1.0/(2*np.pi*cut); a=dt/(rc+dt)
    y=np.empty_like(x); prev=0.0
    for i in range(len(x)):
        prev=prev+a*(x[i]-prev); y[i]=prev
    return y
warm=onepole_lp(buf,2600,SR)
buf=0.35*buf+0.65*warm

# Fades
fin=smoothstep(t/1.4); fout=smoothstep((DUR-t)/2.6)
buf*=fin*fout
# Normaliza + soft-clip (tanh) para suavidad
buf/=np.max(np.abs(buf))+1e-9
buf=np.tanh(buf*1.1)*0.9

# WAV estéreo
out="C:/Users/david/AppData/Local/Temp/claude/C--Users-david-OneDrive-Desktop-CACapp-cacapp/72b910aa-54eb-4cf8-b92f-8334859b95dc/scratchpad/memorial_music.wav"
d=np.empty((len(buf)*2,),dtype=np.int16)
d[0::2]=(buf*32767).astype(np.int16); d[1::2]=(buf*32767).astype(np.int16)
with wave.open(out,'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes())
print("OK", out)
