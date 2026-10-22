#!/usr/bin/env bash
# Makes the robot story's placeholder music, public/demo/music.mp3: 45 s
# at 80 beats a minute, so each 3-second shot of the story is one 4/4 bar and every cut lands on a
# downbeat, then a second of silence, so the file is at least as long as the cut however a browser
# counts an MP3's padding. It's synthesized here from ffmpeg's lavfi sources (no samples, nothing downloaded), so
# it has no license restrictions. Run it from anywhere: `bash scripts/make-demo-music.sh`. Needs
# ffmpeg with libmp3lame.
set -euo pipefail
cd "$(dirname "$0")/.."

quiet=(-y -hide_banner -loglevel error)
seconds=45
# The silence after it.
tail=1

# One chord per bar, in A minor: Am F C G | Am F C G | F G Em Am | F G Am.
chords=(Am F C G Am F C G F G Em Am F G Am)

# A chord's bass note and its three pad tones, in Hz.
bass_of() {
  case $1 in Am) echo 110 ;; F) echo 87.31 ;; C) echo 130.81 ;; G) echo 98 ;; Em) echo 82.41 ;; esac
}
tone_of() {
  case $1-$2 in
    Am-1) echo 220 ;; Am-2) echo 261.63 ;; Am-3) echo 329.63 ;;
    F-1) echo 174.61 ;; F-2) echo 220 ;; F-3) echo 261.63 ;;
    C-1) echo 196 ;; C-2) echo 261.63 ;; C-3) echo 329.63 ;;
    G-1) echo 196 ;; G-2) echo 246.94 ;; G-3) echo 293.66 ;;
    Em-1) echo 164.81 ;; Em-2) echo 196 ;; Em-3) echo 246.94 ;;
  esac
}

# An expression for a value that changes with the bar: `per_bar bass` is
# if(eq(ld(1),0),110,if(eq(ld(1),1),87.31,…)), where ld(1) holds the bar's number, floor(t/3).
per_bar() {
  local kind=$1 tone=${2:-} expr="" last=$((${#chords[@]} - 1)) bar value
  for ((bar = last; bar >= 0; bar--)); do
    if [ "$kind" = bass ]; then value=$(bass_of "${chords[bar]}"); else value=$(tone_of "${chords[bar]}" "$tone"); fi
    if [ "$bar" -eq "$last" ]; then expr=$value; else expr="if(eq(ld(1),$bar),$value,$expr)"; fi
  done
  echo "$expr"
}

bar="st(1,floor(t/3))"
t1=$(per_bar tone 1)
t2=$(per_bar tone 2)
t3=$(per_bar tone 3)
root=$(per_bar bass)

# Pad: the chord's three tones and the root an octave up, swelling in and out over each bar; the
# right channel is tuned 0.3 % sharp, which widens it.
pad_env="min(1,ld(2)/0.5)*min(1,(3-ld(2))/0.5)"
pad() {
  local d=$1
  echo "$bar;st(2,mod(t,3));0.075*(sin(2*PI*($t1)*$d*t)+sin(2*PI*($t2)*$d*t)+sin(2*PI*($t3)*$d*t)+0.6*sin(2*PI*($t1)*2*$d*t))*$pad_env"
}

# Bass: the root, plucked on beats 1 and 3, with a little of its octave.
bass="$bar;st(3,mod(t,1.5));0.3*(sin(2*PI*($root)*t)+0.25*sin(2*PI*($root)*2*t))*exp(-3.5*ld(3))*min(1,ld(3)/0.004)"

# Arpeggio: the chord's tones an octave up, one every eighth note (0.375 s), quiet.
step="st(4,mod(floor(mod(t,3)/0.375),4));st(5,mod(t,0.375))"
arp_note="if(eq(ld(4),0),$t1,if(eq(ld(4),1),$t2,if(eq(ld(4),2),$t3,$t2)))"
arp="$bar;$step;0.055*sin(2*PI*($arp_note)*2*t)*exp(-12*ld(5))*min(1,ld(5)/0.003)"

# Drums: a kick on beats 1 and 3 (a falling sine), a snare on 2 and 4 and a hi-hat between the
# beats (noise, filtered below).
kick="st(6,mod(t,1.5));0.55*sin(2*PI*(46*ld(6)+2.4*(1-exp(-30*ld(6)))))*exp(-8*ld(6))"
snare="st(7,mod(t+0.75,1.5));0.22*(2*random(8)-1)*exp(-22*ld(7))"
hat="st(9,mod(t+0.375,0.75));0.12*(2*random(10)-1)*exp(-70*ld(9))"

# Quoted, so the expressions' commas and semicolons aren't read as the filter graph's own.
source() { echo "aevalsrc=exprs='$1':s=44100:d=$((seconds + tail))"; }

mkdir -p public/demo
ffmpeg "${quiet[@]}" \
  -f lavfi -i "$(source "$(pad 1)|$(pad 1.003)")" \
  -f lavfi -i "$(source "$bass")" \
  -f lavfi -i "$(source "$arp")" \
  -f lavfi -i "$(source "$kick")" \
  -f lavfi -i "$(source "$snare")" \
  -f lavfi -i "$(source "$hat")" \
  -filter_complex "\
[1]pan=stereo|c0=c0|c1=c0[b];\
[2]pan=stereo|c0=0.8*c0|c1=c0,aecho=0.6:0.5:375:0.3[a];\
[3]pan=stereo|c0=c0|c1=c0[k];\
[4]bandpass=f=1800:w=1200,pan=stereo|c0=c0|c1=c0[s];\
[5]highpass=f=7000,pan=stereo|c0=c0|c1=0.7*c0[h];\
[0][b][a][k][s][h]amix=inputs=6:normalize=0,\
alimiter=limit=0.9,loudnorm=I=-16:TP=-1.5:LRA=11,\
afade=t=in:d=0.5,afade=t=out:st=$((seconds - 3)):d=3,aresample=44100" \
  -t "$((seconds + tail))" -c:a libmp3lame -b:a 128k -ac 2 -map_metadata -1 -fflags +bitexact \
  public/demo/music.mp3

ls -l public/demo/music.mp3
